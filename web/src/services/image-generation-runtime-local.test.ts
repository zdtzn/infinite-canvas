import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("reload restores locally stored result and reference URLs without generating again", async () => {
    const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./__fixtures__/image-generation-runtime-local.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => child.kill(), 5000);
    try {
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        assert.equal(code, 0, `${stdout}\n${stderr}`);
        assert.match(stdout, /local result reload passed/);
    } finally {
        clearTimeout(timeout);
    }
});
