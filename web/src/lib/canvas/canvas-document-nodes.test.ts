import { expect, test } from "bun:test";
import { createCanvasDocumentNodes } from "./canvas-document-nodes";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const image: CanvasNodeData = {
    id: "image",
    type: CanvasNodeType.Image,
    title: "Image",
    position: { x: 0, y: 0 },
    width: 320,
    height: 240,
    metadata: { status: "loading", jobId: "job", prompt: "original", generationProgress: { jobId: "job", phase: "queued", reconnecting: false } },
};

test("phase and reconnect changes preserve document identity without mutating live nodes", () => {
    const project = createCanvasDocumentNodes();
    const nodes = [image];
    const first = project(nodes);
    expect(first[0].metadata?.generationProgress).toBeUndefined();
    expect(nodes[0].metadata?.generationProgress?.phase).toBe("queued");
    expect(project(nodes)).toBe(first);
    for (const phase of ["waiting_upstream", "persisting"] as const) {
        expect(project([{ ...image, metadata: { ...image.metadata, generationProgress: { jobId: "job", phase, reconnecting: true } } }])).toBe(first);
    }
    expect(project(first)).toBe(first); // Restoring an undo entry retains its identity.
});

test("geometry, prompt, job and completed image changes remain document edits", () => {
    for (const next of [
        { ...image, position: { x: 100, y: 0 } },
        { ...image, title: "Renamed" },
        { ...image, width: 640 },
        { ...image, metadata: { ...image.metadata, prompt: "changed" } },
        { ...image, metadata: { ...image.metadata, jobId: "retry-job" } },
        { ...image, metadata: { ...image.metadata, status: "success" as const, content: "result", storageKey: "image:result" } },
    ]) {
        const project = createCanvasDocumentNodes();
        const first = project([image]);
        const changed = project([next]);
        expect(changed).not.toBe(first);
        expect(changed[0].metadata?.generationProgress).toBeUndefined();
        expect(changed[0].position).toEqual(next.position);
        expect(changed[0].metadata?.content).toBe(next.metadata?.content);
    }
});

test("interleaved live, history and snapshot reads never reuse another source's document", () => {
    const project = createCanvasDocumentNodes();
    const live = [image];
    const history = [{ ...image, title: "Before", metadata: { status: "success" as const, content: "before" } }];
    const snapshot = [{ ...image, title: "Snapshot", metadata: { status: "success" as const, content: "snapshot" } }];
    const sources = [live, history, snapshot, live, snapshot, history, live, []];
    for (const nodes of sources) {
        const expected = nodes.map((node) => {
            const { generationProgress: _progress, ...metadata } = node.metadata || {};
            return { ...node, metadata };
        });
        const result = project(nodes);
        expect(result).toEqual(expected);
        expect(project(nodes)).toBe(result); // Same-source shortcut after every interleave.
    }
    expect(live[0].metadata?.generationProgress?.phase).toBe("queued");
});

test("restored history identity survives render, snapshot capture and phase-only reads", () => {
    const project = createCanvasDocumentNodes();
    const before = project([image]);
    const after = project([{ ...image, position: { x: 100, y: 0 } }]);
    for (const entry of [before, after, before]) {
        expect(project(entry)).toBe(entry); // applyHistory primes the restored entry.
        const live = entry.map((node) => ({ ...node, metadata: { ...node.metadata, generationProgress: { jobId: "job", phase: "persisting" as const, reconnecting: false } } }));
        expect(project(live)).toBe(entry); // Render projection.
        expect(project(live)).toBe(entry); // createHistoryEntry / snapshot capture.
        expect(project(live.map((node) => ({ ...node, metadata: { ...node.metadata, generationProgress: { ...node.metadata.generationProgress, reconnecting: true } } })))).toBe(entry);
    }
});
