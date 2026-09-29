import type { Database } from "bun:sqlite";

export type ImageHistoryRecoveryJob = {
  id: string;
  prompt: string;
  model: string;
  createdAt: number;
  imageIds: string[];
};

// At most one owner record or deletion marker per job; one streaming owner pass per batch.
export function queryImageHistoryRecovery(
  database: Database,
  userId: string,
  jobs: ImageHistoryRecoveryJob[],
) {
  if (jobs.length > 50) throw new Error("图片历史恢复每批最多查询 50 个任务");
  if (!jobs.length) return [];
  const requested = new Set(jobs.map((job) => job.id));
  const hidden = new Map<string, number>();
  for (const row of database
    .query(
      "SELECT history_kind, record_id, deleted_at, job_ids_json FROM generation_history_tombstones WHERE user_id = ?",
    )
    .iterate(userId) as Iterable<{
    history_kind: string;
    record_id: string;
    deleted_at: number;
    job_ids_json: string;
  }>) {
    const ids: string[] = JSON.parse(row.job_ids_json);
    if (row.history_kind === "image" && row.record_id.startsWith("server-job:"))
      ids.push(row.record_id.slice(11));
    for (const id of ids)
      if (requested.has(id))
        hidden.set(id, Math.max(hidden.get(id) || 0, row.deleted_at));
  }
  const direct = database.query(
    "SELECT payload_json FROM generation_history_items WHERE user_id = ? AND history_kind = 'image' AND record_id = ?",
  );
  const matches = new Map<
    string,
    { rank: number; record: Record<string, unknown> }
  >();
  const pending = new Set<string>();
  const imageJobs = new Map<string, string[]>();
  const promptJobs = new Map<string, ImageHistoryRecoveryJob[]>();
  for (const job of jobs) {
    const fallbackId = `server-job:${job.id}`;
    const deletedAt = hidden.get(job.id);
    if (deletedAt !== undefined) {
      matches.set(job.id, { rank: -1, record: { id: fallbackId, deletedAt } });
      continue;
    }
    const row = direct.get(userId, fallbackId) as {
      payload_json: string;
    } | null;
    if (row) {
      matches.set(job.id, { rank: -1, record: JSON.parse(row.payload_json) });
      continue;
    }
    pending.add(job.id);
    for (const id of job.imageIds)
      imageJobs.set(id, [...(imageJobs.get(id) || []), job.id]);
    const key = JSON.stringify([job.prompt, job.model]);
    promptJobs.set(key, [...(promptJobs.get(key) || []), job]);
  }
  if (pending.size) {
    // Ordering preserves newest-record tie breaking. Retain only <=50 best candidates,
    // not a full decoded history cache, and parse each owner row at most once.
    const rows = database.prepare(
      "SELECT payload_json, created_at FROM generation_history_items WHERE user_id = ? AND history_kind = 'image' ORDER BY updated_at DESC, record_id ASC",
    );
    try {
      for (const row of rows.iterate(userId) as Iterable<{
        payload_json: string;
        created_at: number;
      }>) {
        const record = JSON.parse(row.payload_json) as Record<
          string,
          unknown
        > & { serverJobIds?: string[]; images?: Array<{ id: string }> };
        const offer = (id: string, rank: number) => {
          if (!pending.has(id) || (matches.get(id)?.rank ?? Infinity) <= rank)
            return;
          matches.set(id, { rank, record });
          if (rank === 0) pending.delete(id);
        };
        for (const id of record.serverJobIds || []) offer(id, 0);
        for (const image of record.images || [])
          for (const id of imageJobs.get(image.id) || []) offer(id, 1);
        for (const job of promptJobs.get(
          JSON.stringify([record.prompt, record.model]),
        ) || []) {
          if (Math.abs(row.created_at - job.createdAt) <= 120_000)
            offer(job.id, 2);
        }
        if (!pending.size) break;
      }
    } finally {
      rows.finalize();
    }
  }
  const records = new Map<string, Record<string, unknown>>();
  for (const job of jobs) {
    const match = matches.get(job.id);
    if (match) records.set(String(match.record.id), match.record);
  }
  return [...records.values()];
}
