import { Queue } from "bullmq";
import Redis from "ioredis";

// Render provides REDIS_URL; local dev uses REDIS_HOST + REDIS_PORT
const redisConnection = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null, tls: {} })
  : new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      maxRetriesPerRequest: null
    });

export { redisConnection };

export const imageQueue = new Queue("image-processing", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});
