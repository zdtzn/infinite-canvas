import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("./dou-emperor-palace.css", import.meta.url), "utf8");

function declarationsFor(selector: string) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
    expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
    return match?.[1] ?? "";
}

test("current realm shadow follows a circular seal", () => {
    expect(declarationsFor(".dep-realm-seal")).toContain("border-radius: 50%;");
});

test("current realm raster layers stay geometrically concentric", () => {
    const aura = declarationsFor(".dep-journey-grid li.is-current .dep-realm-aura");
    const medal = declarationsFor(".dep-journey-grid li.is-current .dep-realm-medal");

    expect(aura).toContain("transform: scale(1.03);");
    expect(medal).toContain("transform: scale(0.98);");
    expect(aura).not.toContain("translate(");
    expect(medal).not.toContain("translate(");
});

test("opaque realm artwork is clipped by its circular frames", () => {
    const auraFrame = declarationsFor(".dep-realm-aura-frame");
    const medalFrame = declarationsFor(".dep-realm-medal-frame");

    expect(auraFrame).toContain("overflow: hidden;");
    expect(auraFrame).toContain("border-radius: 50%;");
    expect(medalFrame).toContain("overflow: hidden;");
    expect(medalFrame).toContain("border-radius: 50%;");
});
