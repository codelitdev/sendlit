import { Worker } from "bullmq";
import { registerWorkerEvents, workerOptions } from "../mail/worker-options";
import {
  MEDIA_DELETION_QUEUE,
  type MediaDeletionJobData,
  processMediaDeletionJob,
} from "./deletion-queue";

const worker = new Worker<MediaDeletionJobData>(
  MEDIA_DELETION_QUEUE,
  (job) => processMediaDeletionJob(job),
  { ...workerOptions, concurrency: 2 },
);

registerWorkerEvents(worker, MEDIA_DELETION_QUEUE);

export default worker;
