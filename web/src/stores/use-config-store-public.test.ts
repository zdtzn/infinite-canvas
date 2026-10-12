import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("public preferences and platform channels initialize in either order without replacing unavailable selections", async () => {
    const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./__fixtures__/config-public-preferences.ts", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => child.kill(), 5000);
    try {
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
        expect(stdout).toContain("public preference initialization passed");
    } finally {
        clearTimeout(timeout);
    }
});
