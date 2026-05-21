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

// Global JSON error handler — prevents Express sending HTML error pages
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal server error";
  res.status(status).json({ error: message });
});

export { app };
