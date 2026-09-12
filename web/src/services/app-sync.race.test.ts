import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("WebDAV race integration scenarios pass with process-isolated mocks", () => {
    const fixture = fileURLToPath(new URL("../../qa/app-sync.race.fixture.test.ts", import.meta.url));
    const result = Bun.spawnSync([process.execPath, "test", fixture], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
    expect(result.exitCode).toBe(0);
});
