import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("public image tasks confirm cancellation and isolate retries, persistence and account changes", async () => {
    const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./__fixtures__/image-generation-runtime-public.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => child.kill(), 10_000);
    try {
        const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        assert.equal(exitCode, 0, `${stdout}\n${stderr}`);
        assert.match(stdout, /owner isolation passed/);
    } finally {
        clearTimeout(timeout);
    }
});
