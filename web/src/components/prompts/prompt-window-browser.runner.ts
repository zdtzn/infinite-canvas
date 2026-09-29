import { before, after, test as browserTest } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
const expect = (actual: unknown) => ({ toBe: (value: unknown) => assert.equal(actual, value), toEqual: (value: unknown) => assert.deepEqual(actual, value), toBeLessThan: (value: number) => assert.ok(Number(actual) < value) });
let browser: any;
let server: Server;
let fixtureUrl: string;
before(async () => {
    const script = execFileSync(process.env.PROMPT_QA_BUN!, ["build", fileURLToPath(new URL("./prompt-window-browser.fixture.tsx", import.meta.url)), "--target=browser", "--define", 'process.env.NODE_ENV="development"'], {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
    });
    server = createServer((request, response) => {
        response.setHeader("content-type", request.url === "/fixture.js" ? "text/javascript" : "text/html");
        response.end(request.url === "/fixture.js" ? script : '<html><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    fixtureUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const { chromium } = await import(pathToFileURL(process.env.PROMPT_QA_PLAYWRIGHT!).href);
    browser = await chromium.launch({ channel: "chrome", headless: true });
});
after(async () => {
    await browser?.close();
    server?.close();
});
async function fixture(run: (page: any) => Promise<void>) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => {
        errors.push(error.message);
        console.error("fixture error:", error.message);
    });
    await page.route("**/*", (route: any) => (new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort()));
    try {
        await page.goto(fixtureUrl);
        await page.waitForFunction(() => document.querySelectorAll("[data-prompt-row='0'] [data-prompt-item]").length === 3, undefined, { timeout: 5000 });
        await run(page);
        expect(errors).toEqual([]);
    } finally {
        await page.close();
    }
}
async function settled(page: any) {
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))));
}

browserTest("real border/header offsets, deep scroll, header resize and reopening remain covered", async () =>
    fixture(async (page) => {
        await page.evaluate(() => {
            document.getElementById("scroller")!.scrollTop = 18000;
        });
        await settled(page);
        const covered = () =>
            page.evaluate(() => {
                const scroller = document.getElementById("scroller")!;
                const bounds = scroller.getBoundingClientRect();
                return Boolean(document.elementFromPoint(bounds.left + 35, bounds.top + scroller.clientTop + 40)?.closest("[data-prompt-item]"));
            });
        expect(await covered()).toBe(true);
        expect(await page.locator("[data-prompt-item]").count()).toBeLessThan(70);
        await page.evaluate(() => window.promptQA.header(900));
        await settled(page);
        expect(await covered()).toBe(true);
        await page.evaluate(() => window.promptQA.active(false));
        await page.setViewportSize({ width: 650, height: 750 });
        await page.evaluate(() => window.promptQA.active(true));
        await page.waitForFunction(() => document.querySelector("[data-prompt-row]")?.children.length === 2);
        await settled(page);
        expect(await covered()).toBe(true);
    }),
);

browserTest("Tab and Shift+Tab cross unmounted rows, scroll into view and preserve pinned focus", async () =>
    fixture(async (page) => {
        await page.locator('[data-action="0-open"]').focus();
        for (let index = 0; index < 60; index++) await page.keyboard.press("Tab");
        expect(await page.evaluate(() => document.activeElement?.getAttribute("data-action"))).toBe("30-open");
        await page.keyboard.press("Shift+Tab");
        expect(await page.evaluate(() => document.activeElement?.getAttribute("data-action"))).toBe("29-copy");
        expect(
            await page.evaluate(() => {
                const target = document.activeElement!.getBoundingClientRect();
                const scroller = document.getElementById("scroller")!;
                const top = scroller.getBoundingClientRect().top + scroller.clientTop;
                return target.top >= top && target.bottom <= top + scroller.clientHeight;
            }),
        ).toBe(true);
        await page.evaluate(() => {
            document.getElementById("scroller")!.scrollTop = 35000;
        });
        await settled(page);
        expect(await page.evaluate(() => document.activeElement?.getAttribute("data-action"))).toBe("29-copy");
        expect(await page.locator("[data-prompt-item]").count()).toBeLessThan(70);
    }),
);

browserTest("responsive regrouping retains the focused action", async () =>
    fixture(async (page) => {
        await page.locator('[data-action="5-copy"]').focus();
        await page.setViewportSize({ width: 400, height: 750 });
        await page.waitForFunction(() => document.querySelector("[data-prompt-row]")?.children.length === 1);
        await settled(page);
        expect(await page.evaluate(() => document.activeElement?.getAttribute("data-action"))).toBe("5-copy");
    }),
);

browserTest("replacement remeasures rows and never overlaps cards", async () =>
    fixture(async (page) => {
        await page.evaluate(() => window.promptQA.replace(310));
        await settled(page);
        expect(
            await page.evaluate(() => {
                const rows = [...document.querySelectorAll("[data-prompt-row]")];
                return rows.every((row, i) => i === 0 || row.getBoundingClientRect().top >= rows[i - 1].getBoundingClientRect().bottom + 11);
            }),
        ).toBe(true);
    }),
);

browserTest("native End/Home scrolling and reverse entry from the footer reach the real boundaries", async () =>
    fixture(async (page) => {
        await page.locator('[data-action="0-open"]').focus();
        await page.keyboard.press("End");
        await page.waitForFunction(
            () => {
                const scroller = document.getElementById("scroller")!;
                return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
            },
            undefined,
            { timeout: 5000 },
        );
        await settled(page);
        await page.locator("#after").focus();
        await page.keyboard.press("Shift+Tab");
        expect(await page.evaluate(() => document.activeElement?.getAttribute("data-action"))).toBe("999-copy");
        await page.keyboard.press("Home");
        await page.waitForFunction(() => document.getElementById("scroller")!.scrollTop === 0, undefined, { timeout: 5000 });
        await settled(page);
        expect(await page.locator("[data-prompt-item='0']").count()).toBe(1);
        expect(await page.locator("[data-prompt-item]").count()).toBeLessThan(70);
    }),
);
