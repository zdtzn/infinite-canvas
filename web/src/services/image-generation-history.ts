import type { ServerJob } from "./server-api";

type ImageHistoryRecord = {
    id: string;
    createdAt: number;
    prompt: string;
    model: string;
    images: Array<{ id: string }>;
    serverJobIds?: string[];
};

export function mergeServerJobsIntoImageHistory<T extends ImageHistoryRecord>(history: T[], jobs: ServerJob[], createFallback: (job: ServerJob) => T) {
    const records = history.map((record) => ({ ...record, serverJobIds: [...(record.serverJobIds || [])] }));
    const imageOwners = new Map<string, number>();
    records.forEach((record, index) => record.images.forEach((image) => imageOwners.set(image.id, index)));

    for (const job of jobs) {
        if (!["succeeded", "failed", "canceled"].includes(job.status) || job.source?.route !== "/image") continue;
        const matchedByImage = (job.result?.images || []).map((image) => imageOwners.get(image.id)).find((index) => index !== undefined);
        const matchedIndex = matchedByImage ?? records.findIndex((record) => record.prompt === job.prompt && record.model === serverJobModelValue(job) && Math.abs(record.createdAt - job.createdAt) <= 120_000);
        if (matchedIndex >= 0) {
            const record = records[matchedIndex];
            if (!record.serverJobIds.includes(job.id)) record.serverJobIds.push(job.id);
            continue;
        }

        const fallback = { ...createFallback(job), serverJobIds: [job.id] };
        const index = records.push(fallback) - 1;
        fallback.images.forEach((image) => imageOwners.set(image.id, index));
    }

    return records.sort((left, right) => right.createdAt - left.createdAt);
}

export function serverJobModelValue(job: Pick<ServerJob, "channelId" | "model">) {
    return job.channelId ? `${job.channelId}::${job.model}` : job.model;
}
