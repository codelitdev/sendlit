import { Worker } from "bullmq";
import { registerWorkerEvents, workerOptions } from "../mail/worker-options";
import {
  CONTACT_DELETION_QUEUE,
  type ContactDeletionJobData,
  processContactDeletionJob,
} from "./deletion-queue";

const worker = new Worker<ContactDeletionJobData>(
  CONTACT_DELETION_QUEUE,
  (job) => processContactDeletionJob(job),
  { ...workerOptions, concurrency: 1 },
);

registerWorkerEvents(worker, CONTACT_DELETION_QUEUE);

export default worker;
