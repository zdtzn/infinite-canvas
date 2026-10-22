import { expect, test } from "bun:test";
import type { ServerJob } from "@/services/server-api";
import { recentImageResults } from "./task-results";

test("returning users can find images finished days ago, newest first", () => {
    const jobs = Array.from({ length: 25 }, (_, index) => ({ id: String(index), status: "succeeded", createdAt: index + 1, finishedAt: index + 2 }) as ServerJob);
    const original = [...jobs];
    const result = recentImageResults(jobs);
    expect(result).toHaveLength(20);
    expect(result[0].id).toBe("24");
    expect(result.at(-1)?.id).toBe("5");
    expect(jobs).toEqual(original);
});

test("active, failed and canceled jobs are not mistaken for completed results", () => {
    const jobs = ["queued", "running", "failed", "canceled", "succeeded"].map((status) => ({ id: status, status, createdAt: 1 }) as ServerJob);
    expect(recentImageResults(jobs).map((job) => job.id)).toEqual(["succeeded"]);
});
