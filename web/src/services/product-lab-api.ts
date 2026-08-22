import type { ProductAnalysis, ProductOutputKind, ProductPlanItem } from "@/features/product-lab/product-lab";
import { serverRequest } from "@/services/server-api";

export type ProductProjectStatus = "draft" | "analyzed" | "planned" | "completed";
export type ProductGenerationStatus = "pending" | "running" | "succeeded" | "failed" | "canceled";

export type ProductProject = {
    id: string;
    title: string;
    platform: string;
    styleKey: string;
    status: ProductProjectStatus;
    sourceAssetKey: string;
    sourceUrl: string;
    brandName: string;
    analysis: ProductAnalysis | Record<string, never>;
    plan: ProductPlanItem[];
    createdAt: number;
    updatedAt: number;
};

export type ProductGeneration = {
    id: string;
    projectId: string;
    outputKind: ProductOutputKind;
    pageIndex: number;
    prompt: string;
    jobId?: string;
    assetKey?: string;
    assetUrl?: string;
    status: ProductGenerationStatus;
    error: string;
    createdAt: number;
    updatedAt: number;
};

export type ProductBatchItem = {
    id: string;
    batchId: string;
    generationId: string;
    jobId?: string;
    status: ProductGenerationStatus;
    error: string;
    generation: ProductGeneration;
};

export type ProductBatch = {
    id: string;
    projectId: string;
    status: "queued" | "running" | "completed" | "failed" | "canceled";
    total: number;
    completed: number;
    failed: number;
    canceled: number;
    createdAt: number;
    updatedAt: number;
};

export type ProductTemplate = {
    id: string;
    platform: string;
    name: string;
    outputKind: ProductOutputKind;
    styleKey: string;
    aspectRatio: string;
    promptTemplate: string;
};

export async function fetchProductLabContext(expectedUserId?: string) {
    return serverRequest<{ analysisAvailable: boolean; templates: ProductTemplate[] }>("/api/product-lab/context", { expectedUserId });
}

export async function fetchProductProjects(expectedUserId?: string) {
    return serverRequest<{ items: ProductProject[] }>("/api/product-lab/projects", { expectedUserId, timeoutMs: 20_000 });
}

export async function createProductProject(input: { title: string; platform: string; styleKey: string; sourceAssetKey: string; brandName?: string }, expectedUserId?: string) {
    return serverRequest<{ project: ProductProject }>("/api/product-lab/projects", { method: "POST", body: input, expectedUserId });
}

export async function updateProductProject(projectId: string, input: Partial<Pick<ProductProject, "title" | "platform" | "styleKey" | "status" | "sourceAssetKey" | "brandName" | "analysis" | "plan">>, expectedUserId?: string) {
    return serverRequest<{ project: ProductProject }>(`/api/product-lab/projects/${encodeURIComponent(projectId)}`, { method: "PATCH", body: input, expectedUserId, timeoutMs: 20_000 });
}

export async function deleteProductProject(projectId: string, expectedUserId?: string) {
    await serverRequest(`/api/product-lab/projects/${encodeURIComponent(projectId)}`, { method: "DELETE", expectedUserId });
}

export async function fetchProductGenerations(projectId: string, expectedUserId?: string) {
    return serverRequest<{ items: ProductGeneration[] }>(`/api/product-lab/projects/${encodeURIComponent(projectId)}/generations`, { expectedUserId, timeoutMs: 20_000 });
}

export async function saveProductGeneration(input: { projectId: string; outputKind: ProductOutputKind; pageIndex: number; prompt: string; jobId?: string; assetKey?: string; status: ProductGenerationStatus; error?: string }, expectedUserId?: string) {
    return serverRequest<{ generation: ProductGeneration }>("/api/product-lab/generations", { method: "POST", body: input, expectedUserId });
}

export async function createProductBatch(input: {
    batchId: string;
    projectId: string;
    channelId: string;
    model: string;
    quality?: string;
    imageQuality?: string;
    imageOutputFormat?: string;
    size?: string;
    background?: string;
    items: Array<{
        itemId?: string;
        generationId?: string;
        outputKind: ProductOutputKind;
        pageIndex: number;
        title?: string;
        prompt: string;
        aspectRatio?: string;
        size?: string;
        quality?: string;
        imageQuality?: string;
        imageOutputFormat?: string;
        background?: string;
    }>;
}, expectedUserId?: string) {
    return serverRequest<{ batch: ProductBatch; items: ProductBatchItem[]; recovered?: boolean }>("/api/product-lab/batches", {
        method: "POST",
        body: input,
        timeoutMs: 60_000,
        expectedUserId,
    });
}

export async function fetchProductBatch(batchId: string, expectedUserId?: string) {
    return serverRequest<{ batch: ProductBatch; items: ProductBatchItem[] }>(`/api/product-lab/batches/${encodeURIComponent(batchId)}`, {
        timeoutMs: 20_000,
        expectedUserId,
    });
}

export async function fetchProductBatches(projectId: string, expectedUserId?: string) {
    return serverRequest<{ items: Array<{ batch: ProductBatch; items: ProductBatchItem[] }> }>(`/api/product-lab/projects/${encodeURIComponent(projectId)}/batches`, {
        timeoutMs: 20_000,
        expectedUserId,
    });
}

export async function analyzeProduct(input: { assetKey: string; platform: string; styleKey: string; notes: string }, expectedUserId?: string) {
    return serverRequest<{ analysis: ProductAnalysis }>("/api/product-lab/analyze", { method: "POST", body: input, expectedUserId, timeoutMs: 90_000 });
}
