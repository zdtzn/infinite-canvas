import { expect, test } from "bun:test";

// Opt in with installed Playwright and Node. Chromium uses a fresh profile.
const enabled = Boolean(process.env.PROMPT_QA_PLAYWRIGHT && process.env.PROMPT_QA_NODE);
(enabled ? test : test.skip)(
    "headless Chrome prompt-grid regression suite",
    async () => {
        const child = Bun.spawn([process.env.PROMPT_QA_NODE!, "--experimental-strip-types", import.meta.dir + "/prompt-window-browser.runner.ts"], { stdout: "inherit", stderr: "inherit", env: { ...process.env, PROMPT_QA_BUN: process.execPath } });
        const timeout = setTimeout(() => child.kill(), 30000);
        try {
            expect(await child.exited).toBe(0);
        } finally {
            clearTimeout(timeout);
        }
    },
    45000,
);
