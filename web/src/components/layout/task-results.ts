import type { ServerJob } from "@/services/server-api";

/** Keep finished images discoverable after a long absence, without loading every image. */
export function recentImageResults(jobs: ServerJob[]) {
    return jobs.filter((job) => job.status === "succeeded")
        .sort((a, b) => (b.finishedAt || b.createdAt) - (a.finishedAt || a.createdAt))
        .slice(0, 20);
}
