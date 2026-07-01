import { Queue } from "bullmq";
import redis from "../services/redis";

const mailQueue = new Queue("mail", { connection: redis });

export default mailQueue;

export async function addMailJob({
  to,
  subject,
  body,
  from,
  teamId,
  headers,
}: {
  to: string[];
  subject: string;
  body: string;
  from: string;
  teamId: string;
  headers?: Record<string, string>;
}) {
  for (const recipient of to) {
    await mailQueue.add("mail", {
      to: recipient,
      subject,
      body,
      from,
      teamId,
      headers,
    });
  }
}
