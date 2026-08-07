import type { ServerJob, ServerJobImage } from "./server-api";

type ImageHistoryItem = {
    id: string;
    dataUrl?: string;
    persisted?: boolean;
    serverJobId?: string;
};

type ImageHistoryRecord = {
    id: string;
    createdAt: number;
    updatedAt?: number;
    prompt: string;
    model: string;
    images: ImageHistoryItem[];
    thumbnails?: string[];
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
            let record = records[matchedIndex];
            if (!record.serverJobIds.includes(job.id)) record.serverJobIds.push(job.id);
            record = mergePersistedImagesIntoHistoryRecord(record, job.result?.images || [], job.id, job.finishedAt || record.updatedAt || record.createdAt);
            records[matchedIndex] = record;
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

export function mergePersistedImagesIntoHistoryRecord<T extends ImageHistoryRecord>(record: T, archivedImages: readonly ImageHistoryItem[] | readonly ServerJobImage[], serverJobId?: string, updatedAt = Date.now()): T {
    const archivedById = new Map(archivedImages.filter((image) => image.persisted !== false && image.dataUrl).map((image) => [image.id, image]));
    let changed = false;
    const images = record.images.map((image) => {
        if (image.persisted !== false) return image;
        const archived = archivedById.get(image.id);
        if (!archived) return image;
        changed = true;
        const archivedServerJobId = "serverJobId" in archived ? archived.serverJobId : undefined;
        return { ...image, ...archived, serverJobId: archivedServerJobId || serverJobId };
    });
    if (!changed) return record;
    return {
        ...record,
        images,
        ...(record.thumbnails ? { thumbnails: images.map((image) => image.dataUrl || "") } : {}),
        updatedAt: Math.max(record.updatedAt || record.createdAt, updatedAt),
    } as T;
}
