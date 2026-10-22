import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

for (const scenario of ["refresh", "stale-read", "lifetime", "suspended"]) {
    test(`platform image default synchronization: ${scenario}`, async () => {
        const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./__fixtures__/platform-model-defaults.ts", import.meta.url)), scenario], { stdout: "pipe", stderr: "pipe" });
        const timeout = setTimeout(() => child.kill(), 5000);
        try {
            const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
            expect({ scenario, code, stdout, stderr }).toMatchObject({ code: 0 });
            expect(stdout).toContain("model default synchronization passed");
        } finally {
            clearTimeout(timeout);
        }
    });
}
