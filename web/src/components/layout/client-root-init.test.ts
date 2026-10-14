import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("cloud preferences survive either channel hydration order while real edits take priority", async () => {
    for (const scenario of ["channels-first", "preferences-first", "edited", "snap-edited"]) {
        const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./__fixtures__/client-preference-sync.ts", import.meta.url)), scenario], { stdout: "pipe", stderr: "pipe" });
        const timeout = setTimeout(() => child.kill(), 5000);
        try {
            const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
            expect({ scenario, code, stdout, stderr }).toMatchObject({ code: 0 });
            expect(stdout).toContain("preference sync passed");
        } finally {
            clearTimeout(timeout);
        }
    }
});
