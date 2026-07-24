import { expect, test } from "bun:test";

import { DOU_EMPEROR_REALM_ID, imperialHeroQuotes, imperialQuoteFor, isDouEmperorRealm, localDayKey } from "./imperial-mode";

test("recognizes only the configured Dou Emperor realm", () => {
    expect(isDouEmperorRealm(DOU_EMPEROR_REALM_ID)).toBe(true);
    expect(isDouEmperorRealm("realm-dou-saint")).toBe(false);
    expect(isDouEmperorRealm(undefined)).toBe(false);
});

test("uses a stable local-day key and quote for one user-day", () => {
    expect(localDayKey(new Date(2026, 6, 24))).toBe("2026-07-24");
    expect(imperialQuoteFor("user-1:2026-07-24")).toBe(imperialQuoteFor("user-1:2026-07-24"));
    expect(imperialHeroQuotes).toContain(imperialQuoteFor("user-1:2026-07-24"));
});
