import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

for (const scenario of ["archive", "archive-failure", "archive-session", "cancel"]) {
    test(`public runtime recovery: ${scenario}`, async () => {
        const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./__fixtures__/image-generation-recovery.ts", import.meta.url)), scenario], { stdout: "pipe", stderr: "pipe" });
        const timeout = setTimeout(() => child.kill(), 5000);
        try {
            const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
            assert.equal(code, 0, `${stdout}\n${stderr}`);
            assert.match(stdout, /passed/);
        } finally { clearTimeout(timeout); }
    });
}

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
