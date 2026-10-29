import { type Job, Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { media } from "../db/schema";
import redis from "../services/redis";
import { deleteMedia as deleteMediaFile } from "./service";

export const MEDIA_DELETION_QUEUE = "media-deletion";
const KEEP_FINISHED_SECONDS = 7 * 24 * 60 * 60;
const RETRY_DELAY_MS = 60_000;

export type MediaDeletionJobData = { teamId: string; mediaLitId: string };

let queue: Queue<MediaDeletionJobData> | undefined;

/** Retries MediaLit deletes that failed inline (#157). Created on first use
 * so importing the media queries never opens a Redis connection. Ten
 * attempts with exponential backoff from a minute cover about 17 hours of
 * MediaLit downtime; a final failure goes to `captureError` through the
 * worker's events. */
function mediaDeletionQueue(): Queue<MediaDeletionJobData> {
  queue ??= new Queue<MediaDeletionJobData>(MEDIA_DELETION_QUEUE, {
    connection: redis,
    defaultJobOptions: {
      removeOnComplete: { age: KEEP_FINISHED_SECONDS },
      removeOnFail: { age: KEEP_FINISHED_SECONDS },
      attempts: 10,
      backoff: { type: "exponential", delay: RETRY_DELAY_MS },
    },
  });
  return queue;
}

/** Queues a MediaLit file for deletion, first tried a minute from now (the
 * inline attempt just failed). One job per file: queueing the same file
 * twice is a no-op. */
export async function queueMediaLitDeletion(data: MediaDeletionJobData): Promise<void> {
  await mediaDeletionQueue().add("delete-medialit-file", data, {
    jobId: `medialit-${data.mediaLitId}`,
    delay: RETRY_DELAY_MS,
  });
}

/** Closes the queue's Redis connection, if it was ever opened. */
export async function closeMediaDeletionQueue(): Promise<void> {
  await queue?.close();
}

/** Deletes a queued file, unless a team uploaded or referenced it again
 * since it was queued (a `media` row for it exists again). */
export async function processMediaDeletionJob(
  job: Pick<Job<MediaDeletionJobData>, "data">,
): Promise<"deleted" | "in_use"> {
  const [row] = await db
    .select({ id: media.id })
    .from(media)
    .where(eq(media.mediaLitId, job.data.mediaLitId))
    .limit(1);
  if (row) return "in_use";
  await deleteMediaFile(job.data.mediaLitId);
  return "deleted";
}
