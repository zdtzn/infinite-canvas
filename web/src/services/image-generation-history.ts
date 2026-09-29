import type { ServerJob, ServerJobImage } from "./server-api";
import { fetchServerGenerationHistory } from "./server-api";

type ImageHistoryItem = {
    id: string;
    dataUrl?: string;
    persisted?: boolean;
    serverJobId?: string;
};

type ImageHistoryRecord = {
    id: string;
    deletedAt?: number;
    ownerUserId?: string;
    createdAt: number;
    updatedAt?: number;
    prompt: string;
    model: string;
    images: ImageHistoryItem[];
    thumbnails?: string[];
    serverJobIds?: string[];
};

type ImageHistoryTombstone = { id: string; deletedAt: number; ownerUserId?: string };

// Lookup only terminal workbench jobs, in bounded batches; never download unrelated history pages.
export async function loadImageHistoryRecoveryIndex<T extends ImageHistoryRecord>(userId: string, jobs: ServerJob[], isCurrent = () => true, fetchPage = fetchServerGenerationHistory): Promise<Array<T | ImageHistoryTombstone>> {
    if (!userId) return [];
    const jobIds = [...new Set(jobs.filter((job) => job.source?.route === "/image" && ["succeeded", "failed", "canceled"].includes(job.status)).map((job) => job.id))];
    if (jobIds.length > 200) throw new Error("图片历史恢复任务数量超过上限");
    const records = new Map<string, T | ImageHistoryTombstone>();
    for (let offset = 0; offset < jobIds.length; offset += 50) {
        if (!isCurrent()) return [];
        const batch = jobIds.slice(offset, offset + 50);
        const response = await fetchPage("image", userId, { recoveryJobIds: batch });
        if (!isCurrent()) return [];
        // An older server may ignore unknown query parameters. Do not treat its ordinary page as an index.
        if (response.hasMore || response.items.length > batch.length || response.recoveryJobIds?.length !== batch.length || batch.some((id) => !response.recoveryJobIds?.includes(id))) throw new Error("图片历史恢复查询不完整");
        for (const item of response.items as Array<T | ImageHistoryTombstone>) {
            if (item.ownerUserId && item.ownerUserId !== userId) continue;
            const previous = records.get(item.id);
            if (!previous?.deletedAt) records.set(item.id, item);
        }
    }
    return [...records.values()];
}

export function mergeServerJobsIntoImageHistory<T extends ImageHistoryRecord>(history: Array<T | ImageHistoryTombstone>, jobs: ServerJob[], createFallback: (job: ServerJob) => T) {
    const deletedIds = new Set(history.filter((record) => record.deletedAt).map((record) => record.id));
    const records = history.filter((record): record is T => !record.deletedAt && !deletedIds.has(record.id)).map((record) => ({ ...record, serverJobIds: [...(record.serverJobIds || [])] }));
    const imageOwners = new Map<string, number>();
    records.forEach((record, index) => record.images.forEach((image) => imageOwners.set(image.id, index)));

    for (const job of jobs) {
        if (!["succeeded", "failed", "canceled"].includes(job.status) || job.source?.route !== "/image") continue;
        if (deletedIds.has(`server-job:${job.id}`)) continue;
        const matchedByJob = records.findIndex((record) => record.id === `server-job:${job.id}` || record.serverJobIds.includes(job.id));
        const matchedByImage = (job.result?.images || []).map((image) => imageOwners.get(image.id)).find((index) => index !== undefined);
        const matchedIndex = matchedByJob >= 0 ? matchedByJob : (matchedByImage ?? records.findIndex((record) => record.prompt === job.prompt && record.model === serverJobModelValue(job) && Math.abs(record.createdAt - job.createdAt) <= 120_000));
        if (matchedIndex >= 0) {
            let record = records[matchedIndex];
            if (!record.serverJobIds.includes(job.id)) record.serverJobIds.push(job.id);
            record = mergePersistedImagesIntoHistoryRecord(record, job.result?.images || [], job.id, job.finishedAt || record.updatedAt || record.createdAt);
            records[matchedIndex] = record;
            continue;
        }

        const fallback = createFallback(job);
        if (deletedIds.has(fallback.id)) continue;
        const index = records.push({ ...fallback, serverJobIds: [job.id] }) - 1;
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
