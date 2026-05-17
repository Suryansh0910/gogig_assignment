import mongoose from "mongoose";
import pino from "pino";

const logger = pino({ name: "db-client" });

export async function connectDB() {
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/media_pipeline";
  try {
    await mongoose.connect(uri);
    logger.info("Connected to MongoDB");
  } catch (error) {
    logger.error({ err: error }, "MongoDB connection error");
    process.exit(1);
  }
}
