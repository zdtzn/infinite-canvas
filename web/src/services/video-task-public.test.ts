import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("public video runtime integrates existing provider adapters and server history with all HTTP intercepted", async () => {
    const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./__fixtures__/video-task-public.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => child.kill(), 7000);
    try {
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
        expect(stdout).toContain("public video integration passed");
    } finally {
        clearTimeout(timeout);
    }
});
