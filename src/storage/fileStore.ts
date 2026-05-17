import multer from "multer";
import multerS3 from "multer-s3";
import { S3Client } from "@aws-sdk/client-s3";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const useS3 = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_S3_BUCKET_NAME;

let storage: multer.StorageEngine;

if (useS3) {
  const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
  storage = multerS3({
    s3: s3,
    bucket: process.env.AWS_S3_BUCKET_NAME!,
    metadata: (req, file, cb) => cb(null, { fieldName: file.fieldname }),
    key: (req, file, cb) => cb(null, `uploads/${uuidv4()}${path.extname(file.originalname)}`)
  });
} else {
  const uploadDir = process.env.UPLOAD_DIR || "./uploads";
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
  });
}

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only JPEG, PNG, and WebP are accepted."));
  }
};

const maxFileSizeMB = parseInt(process.env.MAX_FILE_SIZE_MB || "10", 10);

export const upload = multer({
  storage,
  limits: { fileSize: maxFileSizeMB * 1024 * 1024 },
  fileFilter
});
