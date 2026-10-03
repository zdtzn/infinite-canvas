import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

for (const scenario of [
    "failed-hydration",
    "offline-reload",
    "latest-edit",
    "remote-page-edit",
    "account-switch",
    "early-account-switch",
    "delete-in-flight",
    "duplicate-delete",
    "delete-failure-reload",
    "delete-account-switch",
    "delete-uncached",
    "stale-hydration",
    "pending-pagination",
    "bounded-retry",
    "automatic-backoff",
    "lost-response",
    "storage-failure",
    "storage-read-failure",
    "delete-storage-failure",
    "prepared-media",
    "account-switch-during-upload",
    "cleanup-unread-outbox",
    "cleanup-read-failure",
    "cleanup-guards",
    "cleanup-modal-recheck",
    "video-sync-url",
    "video-sync-latest-edit",
    "video-sync-account-switch",
    "video-sync-session-switch",
    "status-ui",
    "local-mode",
]) {
    test(`asset outbox: ${scenario}`, () => {
        const fixture = fileURLToPath(new URL("./__fixtures__/asset-sync-queue.ts", import.meta.url));
        const result = Bun.spawnSync([process.execPath, "--no-env-file", fixture, scenario], { stdout: "pipe", stderr: "pipe" });
        if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
        expect(result.exitCode).toBe(0);
    });
}
