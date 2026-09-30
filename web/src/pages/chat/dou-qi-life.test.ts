import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { readChatMode, shouldSubmitLifeAction, usableLifeItems, writeLifePreference } from "./dou-qi-life-preferences";

test("real life hook lifecycle regressions run in an isolated process", () => {
    const result = Bun.spawnSync([process.execPath, fileURLToPath(new URL("./dou-qi-life-lifecycle.fixture.ts", import.meta.url))], { cwd: fileURLToPath(new URL("../../../", import.meta.url)) });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("lifecycle regressions passed");
});

test("IME Enter and Shift Enter do not submit an unfinished action", () => {
    expect(shouldSubmitLifeAction({ shiftKey: false, nativeEvent: { isComposing: true } })).toBe(false);
    expect(shouldSubmitLifeAction({ shiftKey: false, nativeEvent: { keyCode: 229 } })).toBe(false);
    expect(shouldSubmitLifeAction({ shiftKey: true, nativeEvent: {} })).toBe(false);
    expect(shouldSubmitLifeAction({ shiftKey: false, nativeEvent: {} })).toBe(true);
});

test("chat mode is optional, per-account, and safe when storage is unavailable", () => {
    expect(readChatMode("alice")).toBe("chat");
    expect(() => writeLifePreference("alice", "mode", "douqi")).not.toThrow();
});

test("only positive-quantity recovery items appear as consumable battle actions", () => {
    const items = [{ id: "1", name: "疗伤丹", category: "丹药", quantity: 1 }, { id: "2", name: "残剑", category: "武器", quantity: 1 }, { id: "3", name: "恢复丹", category: "丹药", quantity: 0 }];
    expect(usableLifeItems({ inventory: { items } } as never).map((item) => item.id)).toEqual(["1"]);
});
