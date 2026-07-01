import { Queue } from "bullmq";
import redis from "../services/redis";

const sequenceQueue = new Queue("sequence", { connection: redis });

export default sequenceQueue;
