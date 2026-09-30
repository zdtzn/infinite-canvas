import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadFunction(path: string, name: string, context: Record<string, unknown>) {
    const source = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
    const fn = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
    const code = ts.transpileModule(`${fn.getText(source).replace(/^export /, "")}; ${name}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return vm.runInNewContext(code, context) as (...args: unknown[]) => Promise<unknown>;
}

for (const stage of ["conversion", "metadata", "thumbnail", "original-upload", "normal"] as const) {
    test(`upload lifecycle: ${stage}`, async () => {
        const controller = new AbortController();
        const uploads: unknown[][] = [];
        const blob = new Blob(["fixture"], { type: "image/png" });
        const stop = (current: string) => { if (stage === current) controller.abort(); };
        const upload = loadFunction("./image-storage.ts", "uploadImage", {
            PUBLIC_MODE: true, useUserStore: { getState: () => ({ user: { id: "a" } }) },
            convertImageOutput: async () => { stop("conversion"); return blob; },
            validDimensions: () => false, readBlobMeta: async () => { stop("metadata"); return { width: 1, height: 1 }; },
            assertImageUploadAllowed: () => {}, createThumbnail: async () => { stop("thumbnail"); return blob; },
            uploadServerAsset: async (...args: unknown[]) => { uploads.push(args); stop("original-upload"); return { asset: { key: "a", url: "a.png" } }; },
        });
        const pending = upload(blob, { signal: controller.signal, expectedUserId: "a" });
        if (stage === "normal") {
            await pending;
            expect(uploads).toHaveLength(2);
            expect(uploads.every((args) => args[3] === "a" && args[4] === controller.signal)).toBe(true);
        } else {
            await expect(pending).rejects.toMatchObject({ name: "AbortError" });
            expect(uploads).toHaveLength(stage === "original-upload" ? 1 : 0);
        }
    });
}

test("asset request forwards abort and pre-aborted requests never fetch", async () => {
    const controller = new AbortController();
    const requests: RequestInit[] = [];
    const upload = loadFunction("./server-api.ts", "uploadServerAsset", {
        FormData, mimeExtension: () => "png", expectedUserHeaders: () => ({}),
        fetch: async (_url: string, init: RequestInit) => { requests.push(init); return {}; }, readJsonResponse: async () => ({}),
    });
    const blob = new Blob();
    await upload(blob, "image", undefined, "a", controller.signal);
    expect(requests[0].signal).toBe(controller.signal);
    controller.abort();
    await expect(upload(blob, "image", undefined, "a", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(requests).toHaveLength(1);
});
