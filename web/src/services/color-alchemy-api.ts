import type { ColorAlchemyDocument } from "@/features/color-alchemy/types";
import { serverRequest } from "@/services/server-api";

export type ColorAlchemyDocumentTombstone = { id: string; deletedAt: string };

export async function fetchColorAlchemyDocuments(expectedUserId?: string) {
    return serverRequest<{ items: ColorAlchemyDocument[]; deleted: ColorAlchemyDocumentTombstone[] }>("/api/color-alchemy/documents", {
        expectedUserId,
        timeoutMs: 20_000,
    });
}

export async function saveColorAlchemyDocument(document: ColorAlchemyDocument, expectedUserId?: string) {
    return serverRequest<{ document?: ColorAlchemyDocument; deleted?: ColorAlchemyDocumentTombstone }>(`/api/color-alchemy/documents/${encodeURIComponent(document.id)}`, {
        method: "PUT",
        body: serializeDocument(document),
        expectedUserId,
        timeoutMs: 20_000,
    });
}

export async function deleteColorAlchemyDocument(id: string, expectedUserId?: string) {
    return serverRequest<{ deleted: ColorAlchemyDocumentTombstone }>(`/api/color-alchemy/documents/${encodeURIComponent(id)}`, {
        method: "DELETE",
        expectedUserId,
    });
}

function serializeDocument(document: ColorAlchemyDocument) {
    const source = stripSourceUrl(document.source);
    return {
        source,
        ...(document.reference
            ? {
                  reference: {
                      ...stripSourceUrl(document.reference),
                      ...(document.reference.analysis ? { analysis: document.reference.analysis } : {}),
                  },
              }
            : {}),
        settings: document.settings,
        history: document.history,
        historyIndex: document.historyIndex,
        updatedAt: document.updatedAt,
        ...(document.analysis ? { analysis: document.analysis } : {}),
    };
}

function stripSourceUrl<T extends { url: string }>(source: T): Omit<T, "url"> {
    const { url: _url, ...value } = source;
    return value;
}
