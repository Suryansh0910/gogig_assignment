import { Queue } from "bullmq";
import Redis from "ioredis";

const redisOptions = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  maxRetriesPerRequest: null
};

export const redisConnection = new Redis(redisOptions);

export const imageQueue = new Queue("image-processing", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});
