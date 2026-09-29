import { Database } from "bun:sqlite";
import {
  queryImageHistoryRecovery,
  type ImageHistoryRecoveryJob,
} from "./image-history-recovery";

// Synthetic payloads only. Run with Bun; the optional argument labels the implementation.
const db = new Database(":memory:");
db.exec(`CREATE TABLE generation_history_items (user_id TEXT, history_kind TEXT, record_id TEXT, payload_json TEXT, created_at INTEGER, updated_at INTEGER, PRIMARY KEY(user_id, history_kind, record_id));
    CREATE INDEX idx_generation_history_user_kind_updated ON generation_history_items(user_id, history_kind, updated_at DESC);
    CREATE TABLE generation_history_tombstones (user_id TEXT, history_kind TEXT, record_id TEXT, deleted_at INTEGER, job_ids_json TEXT, PRIMARY KEY(user_id, history_kind, record_id));`);
const put = db.query(
  "INSERT INTO generation_history_items VALUES (?, 'image', ?, ?, ?, ?)",
);
const jobs: ImageHistoryRecoveryJob[] = [];
db.transaction(() => {
  for (let i = 0; i < 10_000; i++) {
    const id = `native-${i}`;
    const createdAt = i * 200_000;
    const job = {
      id: `job-${i}`,
      prompt: `prompt-${i}`,
      model: "channel::model",
      createdAt,
      imageIds: [`image-${i}`],
    };
    const record = {
      id,
      createdAt,
      updatedAt: createdAt,
      prompt: job.prompt,
      model: job.model,
      serverJobIds: [job.id],
      images: [{ id: job.imageIds[0], dataUrl: `/synthetic/${i}.png` }],
      notes: "x".repeat(2048),
    };
    put.run("owner", id, JSON.stringify(record), createdAt, createdAt);
    if (i % 50 === 0) jobs.push(job);
  }
})();
const runs: number[] = [];
const batchTimes: number[] = [];
for (let run = 0; run < 4; run++) {
  const start = performance.now();
  let count = 0;
  for (let offset = 0; offset < jobs.length; offset += 50) {
    const batchStart = performance.now();
    count += queryImageHistoryRecovery(
      db,
      "owner",
      jobs.slice(offset, offset + 50),
    ).length;
    if (run) batchTimes.push(performance.now() - batchStart);
  }
  if (count !== 200)
    throw new Error(`Expected 200 matching native records, got ${count}`);
  if (run) runs.push(performance.now() - start);
}
runs.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    label: process.argv[2] || "current",
    bun: Bun.version,
    histories: 10_000,
    jobs: jobs.length,
    payloadPaddingBytes: 2048,
    warmups: 1,
    measuredRuns: 3,
    totalMs: runs.map(Math.round),
    medianMs: Math.round(runs[1]),
    maxSynchronousBatchMs: Math.round(Math.max(...batchTimes)),
  }),
);
db.close();
