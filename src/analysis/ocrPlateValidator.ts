import { RekognitionClient, DetectTextCommand } from "@aws-sdk/client-rekognition";
import fs from "fs";
import { CheckResult } from "../types";

const PLATE_REGEX = /([A-Z]{2}[0-9]{2}[A-Z]{1,2}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})/;

async function extractTextWithRekognition(filepath: string): Promise<string[]> {
  const s3Bucket = process.env.AWS_S3_BUCKET_NAME;
  const client = new RekognitionClient({ region: process.env.AWS_REGION || "us-east-1" });

  let imageParam: any;

  if (s3Bucket && (filepath.includes(".amazonaws.com") || filepath.includes("s3://"))) {
    // Parse out just the S3 key from the full HTTPS URL
    // e.g. https://bucket.s3.amazonaws.com/uploads/uuid.webp  → uploads/uuid.webp
    let key: string;
    if (filepath.includes(".amazonaws.com/")) {
      key = filepath.split(".amazonaws.com/")[1];
    } else {
      key = filepath.split("/").slice(3).join("/");
    }
    console.log(`[Rekognition] Using S3 object: bucket=${s3Bucket}, key=${key}`);
    imageParam = { S3Object: { Bucket: s3Bucket, Name: key } };
  } else {
    // For local files, convert to JPEG (Rekognition does not support WebP)
    const sharp = (await import("sharp")).default;
    const imageBytes = await sharp(filepath).jpeg().toBuffer();
    imageParam = { Bytes: imageBytes };
    console.log(`[Rekognition] Using converted JPEG bytes from: ${filepath}`);
  }

  const response = await client.send(new DetectTextCommand({ Image: imageParam }));
  const detections = response.TextDetections || [];

  // Log all detections for debugging
  const allLines = detections
    .filter(d => d.Type === "LINE")
    .map(d => `"${d.DetectedText}" (${d.Confidence?.toFixed(1)}%)`);
  console.log(`[Rekognition] All LINE detections: ${allLines.join(", ")}`);

  // Return all LINE-level text regardless of confidence for plate matching
  return detections
    .filter(d => d.Type === "LINE")
    .map(d => (d.DetectedText || "").replace(/\s+/g, "").toUpperCase());
}

export async function validateNumberPlate(filepath: string): Promise<CheckResult> {
  try {
    const useRekognition = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

    let matched = false;
    let extractedText = "";
    let confidence = 0;
    let engine = "tesseract";

    if (useRekognition) {
      engine = "aws-rekognition";
      const lines = await extractTextWithRekognition(filepath);

      for (const line of lines) {
        // Remove spaces within each detected line before matching
        const noSpaces = line.replace(/\s+/g, "");
        const match = noSpaces.match(PLATE_REGEX);
        if (match) {
          matched = true;
          extractedText = match[0];
          confidence = 1.0;
          break;
        }
      }

      // If no pattern match, return the raw text for visibility
      if (!extractedText && lines.length > 0) {
        extractedText = lines.join(" ");
      }
    } else {
      // Fallback to Tesseract if no AWS credentials
      const Tesseract = (await import("tesseract.js")).default;
      const sharp = (await import("sharp")).default;

      const processedBuffer = await sharp(filepath).greyscale().normalize().toBuffer();
      const { data: { text } } = await Tesseract.recognize(processedBuffer, "eng");
      
      let cleanedText = text.replace(/[\s\W_]+/g, "").toUpperCase().replace("IND", "");
      const match = cleanedText.match(PLATE_REGEX);
      if (match) {
        matched = true;
        extractedText = match[0];
      } else {
        extractedText = text.replace(/\n/g, " ").trim();
      }
    }

    return {
      name: "ocr_plate_validation",
      passed: matched,
      score: matched ? 1.0 : 0.0,
      detail: {
        extractedText,
        matchesIndianFormat: matched,
        engine,
        regex: "Standard (MH01AB1234) or BH Series (22BH6517A)"
      }
    };
  } catch (error: any) {
    return {
      name: "ocr_plate_validation",
      passed: false,
      score: 0,
      detail: {},
      error: error.message
    };
  }
}
