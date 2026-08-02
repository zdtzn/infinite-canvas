import { expect, test } from "bun:test";

import { LOGIN_TRANSITION_MS, loginTransitionMessages, realmWelcomeMessages, selectRealmMessage } from "./login-realm";

test("login realm provides varied creator-world welcomes without generic login copy", () => {
    expect(realmWelcomeMessages.length).toBeGreaterThanOrEqual(5);
    expect(realmWelcomeMessages.every((message) => message.title && message.description.length >= 1)).toBe(true);
    expect(realmWelcomeMessages.some((message) => `${message.title}${message.description.join("")}`.includes("欢迎登录"))).toBe(false);
});

test("login realm message selection is stable for the same seed", () => {
    expect(selectRealmMessage("same-creator")).toEqual(selectRealmMessage("same-creator"));
    expect(realmWelcomeMessages).toContain(selectRealmMessage("another-creator"));
});

test("login transition stays brief and uses world-consistent feedback", () => {
    expect(LOGIN_TRANSITION_MS).toBeGreaterThanOrEqual(500);
    expect(LOGIN_TRANSITION_MS).toBeLessThanOrEqual(800);
    expect(loginTransitionMessages.length).toBeGreaterThanOrEqual(3);
});
