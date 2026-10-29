import type { ContactDeletion, ContactSelection } from "@sendlit/api-contract";
import { type Job, Queue } from "bullmq";
import { genPublicId } from "../db/id";
import redis from "../services/redis";
import {
  captureBulkDeletion,
  countSelection,
  deleteMatchingContacts,
  INLINE_DELETE_LIMIT,
  newCutoffId,
  type StartDeletionResult,
  selectionCondition,
} from "./bulk-delete";

export const CONTACT_DELETION_QUEUE = "contact-deletion";
const KEEP_FINISHED_SECONDS = 24 * 60 * 60;

export type ContactDeletionJobData = {
  teamId: string;
  selection: ContactSelection;
  cutoffId: string;
  count: number;
  actorUserId: string | null;
};

export type ContactDeletionProgress = { deleted: number; suppressed: number };

/** Large bulk contact deletions. Retrying is safe: a rerun only sees the
 * contacts that are left. Finished jobs stay a day so callers can read the
 * outcome from `GET /contacts/bulk-delete/:deletionId`. */
const contactDeletionQueue = new Queue<ContactDeletionJobData>(CONTACT_DELETION_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: { age: KEEP_FINISHED_SECONDS },
    removeOnFail: { age: KEEP_FINISHED_SECONDS },
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
  },
});

export default contactDeletionQueue;

/**
 * Deletes a selection: inline when it is small, otherwise as a background
 * job. With `expectedCount`, nothing is deleted if the live count differs.
 */
export async function startContactDeletion({
  teamId,
  selection,
  expectedCount,
  actorUserId,
}: {
  teamId: string;
  selection: ContactSelection;
  expectedCount?: number;
  actorUserId?: string | null;
}): Promise<StartDeletionResult> {
  const cutoffId = newCutoffId();
  const resolved = await selectionCondition(teamId, selection, cutoffId);
  if ("error" in resolved) {
    return resolved.error === "segment_not_found"
      ? { status: 404, body: { error: "segment_not_found" } }
      : { status: 400, body: { error: resolved.error } };
  }
  const { count } = await countSelection(resolved.condition);
  if (expectedCount !== undefined && expectedCount !== count) {
    return { status: 409, body: { error: "count_changed", count } };
  }
  if (count <= INLINE_DELETE_LIMIT) {
    const result = await deleteMatchingContacts(teamId, resolved.condition, {
      actorUserId,
    });
    captureBulkDeletion({ teamId, selection, deletionId: null, ...result });
    return {
      status: 200,
      body: { deletionId: null, status: "completed", count, ...result },
    };
  }
  const deletionId = genPublicId("cdel");
  await contactDeletionQueue.add(
    "delete-contacts",
    { teamId, selection, cutoffId, count, actorUserId: actorUserId ?? null },
    { jobId: deletionId },
  );
  return {
    status: 202,
    body: { deletionId, status: "queued", count, deleted: 0, suppressed: 0 },
  };
}

/** Runs one queued deletion. Progress carries over between attempts. */
export async function processContactDeletionJob(
  job: Pick<Job<ContactDeletionJobData>, "id" | "data" | "progress" | "updateProgress">,
): Promise<ContactDeletionProgress> {
  const { teamId, selection, cutoffId, actorUserId } = job.data;
  const resolved = await selectionCondition(teamId, selection, cutoffId);
  // The segment was deleted after the job was queued: nothing to match.
  if ("error" in resolved) throw new Error(resolved.error);
  const before = readProgress(job.progress);
  const result = await deleteMatchingContacts(teamId, resolved.condition, {
    actorUserId,
    onProgress: (progress) =>
      job.updateProgress({
        deleted: before.deleted + progress.deleted,
        suppressed: before.suppressed + progress.suppressed,
      }),
  });
  const total = {
    deleted: before.deleted + result.deleted,
    suppressed: before.suppressed + result.suppressed,
  };
  await job.updateProgress(total);
  captureBulkDeletion({ teamId, selection, deletionId: String(job.id), ...total });
  return total;
}

function readProgress(progress: unknown): ContactDeletionProgress {
  if (progress && typeof progress === "object") {
    const { deleted, suppressed } = progress as Partial<ContactDeletionProgress>;
    return { deleted: Number(deleted) || 0, suppressed: Number(suppressed) || 0 };
  }
  return { deleted: 0, suppressed: 0 };
}

/** A background deletion's progress, or null when it isn't this team's. */
export async function getContactDeletion(
  teamId: string,
  deletionId: string,
): Promise<ContactDeletion | null> {
  const job = await contactDeletionQueue.getJob(deletionId);
  if (!job || job.data?.teamId !== teamId) return null;
  const state = await job.getState();
  const status: ContactDeletion["status"] =
    state === "completed"
      ? "completed"
      : state === "failed"
        ? "failed"
        : state === "active"
          ? "running"
          : "queued";
  const progress = readProgress(state === "completed" ? job.returnvalue : job.progress);
  return { deletionId, status, count: job.data.count, ...progress };
}
