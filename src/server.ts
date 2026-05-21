import { app } from "./app";
import { connectDB } from "./db/client";
import pino from "pino";
import http from "http";
import { Server } from "socket.io";
import { QueueEvents } from "bullmq";
import { redisConnection } from "./queue/jobQueue";
import { startWorker } from "./workers/imageWorker";

const logger = pino({ name: "server" });

async function startServer() {
  await connectDB();
  startWorker();

  const server = http.createServer(app);
  const io = new Server(server);

  io.on("connection", (socket) => {
    socket.on("subscribe", (jobId) => {
      socket.join(jobId);
      logger.info({ jobId, socketId: socket.id }, "Client subscribed to job updates");
    });
  });

  const queueEvents = new QueueEvents("image-processing", { connection: redisConnection });
  
  queueEvents.on("completed", ({ jobId }) => {
    io.to(jobId).emit("job-completed", { jobId });
  });

  queueEvents.on("failed", ({ jobId, failedReason }) => {
    io.to(jobId).emit("job-failed", { jobId, failedReason });
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    logger.info(`API server listening on port ${port}`);
  });
}

startServer();
