import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("pending image previews render independently of suite module mocks", async () => {
    const child = Bun.spawn([process.execPath, "--no-env-file", "test", fileURLToPath(new URL("../../../qa/pending-image-card.fixture.test.tsx", import.meta.url))], {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)), stdout: "pipe", stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill(), 10_000);
    try {
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect({ code, stdout, stderr }).toMatchObject({ code: 0 });
        expect(`${stdout}\n${stderr}`).toContain("3 pass");
    } finally { clearTimeout(timeout); }
}, 15_000);
