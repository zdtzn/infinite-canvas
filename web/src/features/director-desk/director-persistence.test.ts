import { test, expect, spyOn } from "bun:test";
import localforage from "localforage";
import { flushCanvasPersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";

test("director scene saves report storage failure and can retry the latest scene at the existing schema version", async () => {
    const before = useCanvasStore.getState();
    const write = spyOn(localforage, "setItem").mockRejectedValue(new Error("QuotaExceededError"));
    try {
        const id = useCanvasStore.getState().createProject("director-test");
        await expect(flushCanvasPersistence(true)).rejects.toThrow("QuotaExceededError");
        write.mockImplementation(async (_name, value) => value);
        await flushCanvasPersistence(true);
        const saved = JSON.parse(write.mock.calls.at(-1)![1] as string);
        expect(saved.version).toBe(useCanvasStore.persist.getOptions().version);
        expect(saved.state.projects.some((project: { id: string }) => project.id === id)).toBe(true);
    } finally { write.mockRestore(); useCanvasStore.setState(before); }
});
