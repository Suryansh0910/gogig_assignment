/**
 * Reset Script — Clears all jobs and analysis results from MongoDB.
 * Use this to clean up test data during development.
 * 
 * Usage: node scripts/reset-db.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

async function reset() {
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/media_pipeline";
  await mongoose.connect(uri);

  const db = mongoose.connection.db;
  const jobsDeleted = await db.collection("jobs").deleteMany({});
  const resultsDeleted = await db.collection("analysisresults").deleteMany({});

  console.log(`✅ Deleted ${jobsDeleted.deletedCount} jobs and ${resultsDeleted.deletedCount} analysis results.`);
  await mongoose.disconnect();
}

reset().catch(err => {
  console.error("❌ Reset failed:", err.message);
  process.exit(1);
});
