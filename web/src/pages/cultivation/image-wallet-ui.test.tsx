import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("image wallet UI SSR scenarios run independently of suite module mocks", async () => {
    const child = Bun.spawn([process.execPath, "--no-env-file", fileURLToPath(new URL("./image-wallet-ui.fixture.tsx", import.meta.url))], {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        stdout: "pipe",
        stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill(), 10_000);
    try {
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
        expect(stdout).toContain("4 image wallet UI SSR scenarios passed");
    } finally {
        clearTimeout(timeout);
    }
}, 15_000);
