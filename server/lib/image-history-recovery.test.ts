import { afterEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  queryImageHistoryRecovery,
  type ImageHistoryRecoveryJob,
} from "./image-history-recovery";

const databases: Database[] = [];
afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
});
function fixture() {
  const db = new Database(":memory:");
  databases.push(db);
  db.exec(`CREATE TABLE generation_history_items (user_id TEXT, history_kind TEXT, record_id TEXT, payload_json TEXT, created_at INTEGER, updated_at INTEGER, PRIMARY KEY(user_id, history_kind, record_id));
        CREATE TABLE generation_history_tombstones (user_id TEXT, history_kind TEXT, record_id TEXT, deleted_at INTEGER, job_ids_json TEXT, PRIMARY KEY(user_id, history_kind, record_id));`);
  const put = (
    id: string,
    fields: Record<string, unknown> = {},
    user = "alice",
    kind = "image",
  ) => {
    const payload = {
      id,
      prompt: "different",
      model: "m",
      createdAt: 1,
      images: [],
      ...fields,
    };
    db.query(
      "INSERT INTO generation_history_items VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      user,
      kind,
      id,
      JSON.stringify(payload),
      Number(payload.createdAt),
      10,
    );
  };
  const erase = (
    id: string,
    jobIds: string[] = [],
    user = "alice",
    kind = "image",
  ) => {
    db.query(
      "INSERT INTO generation_history_tombstones VALUES (?, ?, ?, ?, ?)",
    ).run(user, kind, id, 99, JSON.stringify(jobIds));
  };
  return { db, put, erase };
}
const job: ImageHistoryRecoveryJob = {
  id: "job",
  prompt: "hello",
  model: "channel::m",
  createdAt: 500_000,
  imageIds: ["image"],
};

test("returns the old relevant record without unrelated payloads or pagination", () => {
  const { db, put } = fixture();
  db.transaction(() => {
    for (let i = 0; i < 1500; i++)
      put(`unrelated-${i}`, { notes: "x".repeat(2048) });
    put("old", { serverJobIds: [job.id] });
  })();
  const before = db
    .query("SELECT COUNT(*) AS count FROM generation_history_items")
    .get();
  expect(
    queryImageHistoryRecovery(db, "alice", [job]).map((record) => record.id),
  ).toEqual(["old"]);
  expect(
    db.query("SELECT COUNT(*) AS count FROM generation_history_items").get(),
  ).toEqual(before);
});

test("matches deterministic ids, image ids, and legacy prompt/model/time records", () => {
  const { db, put } = fixture();
  put("server-job:job");
  put("by-image", { images: [{ id: "second-image" }] });
  put("legacy", { prompt: "legacy", model: "channel::m", createdAt: 700_000 });
  const rows = queryImageHistoryRecovery(db, "alice", [
    job,
    { ...job, id: "second", imageIds: ["second-image"] },
    { ...job, id: "third", prompt: "legacy", createdAt: 700_000, imageIds: [] },
  ]);
  expect(rows.map((row) => row.id)).toEqual([
    "server-job:job",
    "by-image",
    "legacy",
  ]);
});

test("identity wins over image and prompt matches; duplicate jobs share one record", () => {
  const { db, put } = fixture();
  put("heuristic", {
    prompt: job.prompt,
    model: job.model,
    createdAt: job.createdAt,
  });
  put("by-image", { images: [{ id: "image" }] });
  put("identity", { serverJobIds: [job.id, "second"] });
  expect(
    queryImageHistoryRecovery(db, "alice", [job, { ...job, id: "second" }]).map(
      (row) => row.id,
    ),
  ).toEqual(["identity"]);
});

test("direct and hidden-job tombstones override stale records", () => {
  const { db, put, erase } = fixture();
  put("server-job:job");
  erase("server-job:job");
  put("legacy", { serverJobIds: ["hidden"] });
  erase("deleted-local-id", ["hidden"]);
  expect(
    queryImageHistoryRecovery(db, "alice", [job, { ...job, id: "hidden" }]),
  ).toEqual([
    { id: "server-job:job", deletedAt: 99 },
    { id: "server-job:hidden", deletedAt: 99 },
  ]);
});

test("neither another owner nor another history kind can match or hide a job", () => {
  const { db, put, erase } = fixture();
  put("foreign", { serverJobIds: [job.id] }, "bob");
  put("video", { serverJobIds: [job.id] }, "alice", "video");
  erase("server-job:job", [job.id], "bob");
  erase("server-job:job", [], "alice", "video");
  expect(queryImageHistoryRecovery(db, "alice", [job])).toEqual([]);
  put("own", { serverJobIds: [job.id] });
  expect(
    queryImageHistoryRecovery(db, "alice", [job]).map((row) => row.id),
  ).toEqual(["own"]);
});

test("hidden job ids in video tombstones follow the shared job-list deletion rules", () => {
  const { db, erase } = fixture();
  erase("deleted-video", [job.id], "alice", "video");
  expect(queryImageHistoryRecovery(db, "alice", [job])).toEqual([
    { id: "server-job:job", deletedAt: 99 },
  ]);
});

test("unmatched old jobs stay missing and model/channel/time must match exactly", () => {
  const { db, put } = fixture();
  put("wrong-channel", {
    prompt: job.prompt,
    model: "other::m",
    createdAt: job.createdAt,
  });
  put("wrong-time", {
    prompt: job.prompt,
    model: job.model,
    createdAt: job.createdAt + 120_001,
  });
  expect(queryImageHistoryRecovery(db, "alice", [job])).toEqual([]);
});

test("refuses oversized batches instead of silently truncating recovery", () => {
  const { db } = fixture();
  expect(() =>
    queryImageHistoryRecovery(
      db,
      "alice",
      Array.from({ length: 51 }, () => job),
    ),
  ).toThrow("最多查询 50");
});

test("a 50-job batch parses each owner row once, not once per job", () => {
  const { db, put } = fixture();
  for (let i = 0; i < 500; i++)
    put(`native-${i}`, { serverJobIds: [`job-${i}`] });
  const jobs = Array.from({ length: 49 }, (_, i) => ({
    ...job,
    id: `job-${i}`,
    imageIds: [],
  }));
  jobs.push({ ...job, id: "missing", imageIds: [] }); // Forces the full pass.
  const parse = JSON.parse;
  let parsed = 0;
  const spy = spyOn(JSON, "parse").mockImplementation(
    (text: string, reviver) => {
      parsed++;
      return parse(text, reviver);
    },
  );
  try {
    expect(queryImageHistoryRecovery(db, "alice", jobs)).toHaveLength(49);
    expect(parsed).toBe(500);
  } finally {
    spy.mockRestore();
  }
});

test("early-exit cursors are released and subsequent calls see fresh updates and deletions", () => {
  const { db, put, erase } = fixture();
  put("native", { serverJobIds: [job.id] });
  put("unrelated");
  for (let i = 0; i < 3; i++)
    expect(queryImageHistoryRecovery(db, "alice", [job])[0].id).toBe("native");
  put("newer", { serverJobIds: [job.id] });
  db.query(
    "UPDATE generation_history_items SET updated_at = 20 WHERE record_id = 'newer'",
  ).run();
  expect(queryImageHistoryRecovery(db, "alice", [job])[0].id).toBe("newer");
  erase("deleted-native", [job.id]);
  expect(queryImageHistoryRecovery(db, "alice", [job])).toEqual([
    { id: "server-job:job", deletedAt: 99 },
  ]);
});

test("older identity beats a newer image match and newest identity wins ties", () => {
  const { db, put } = fixture();
  put("image", { images: [{ id: "image" }] });
  put("old-identity", { serverJobIds: [job.id] });
  put("new-identity", { serverJobIds: [job.id] });
  db.query(
    "UPDATE generation_history_items SET updated_at = CASE record_id WHEN 'image' THEN 30 WHEN 'new-identity' THEN 20 ELSE 10 END",
  ).run();
  expect(queryImageHistoryRecovery(db, "alice", [job])[0].id).toBe(
    "new-identity",
  );
});
