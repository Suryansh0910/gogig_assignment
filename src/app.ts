import express from "express";
import pinoHttp from "pino-http";
import dotenv from "dotenv";
import path from "path";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

dotenv.config();

import { uploadHandler } from "./api/upload";
import { statusHandler } from "./api/status";
import { resultsHandler } from "./api/results";
import { failureHandler } from "./api/failure";

const app = express();

app.use(helmet({
  contentSecurityPolicy: false // Disable CSP for local dev/Socket.IO simplicity
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window`
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this IP, please try again after 15 minutes" }
});

app.use(express.json());
app.use(pinoHttp());

app.use(express.static(path.join(__dirname, "../public")));

app.post("/upload", apiLimiter, uploadHandler);
app.get("/jobs/:id/status", statusHandler);
app.get("/jobs/:id/results", resultsHandler);
app.get("/jobs/:id/failure", failureHandler);

export { app };
