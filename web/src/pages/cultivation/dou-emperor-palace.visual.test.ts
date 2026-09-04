import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("./dou-emperor-palace.css", import.meta.url), "utf8");
const component = readFileSync(new URL("./dou-emperor-palace.tsx", import.meta.url), "utf8");

function declarationsFor(selector: string) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
    expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
    return match?.[1] ?? "";
}

test("current realm shadow follows a circular seal", () => {
    expect(declarationsFor(".dep-realm-seal")).toContain("border-radius: 50%;");
});

test("journey insignia use one centered raster layer", () => {
    const medal = declarationsFor(".dep-journey-grid li.is-current .dep-realm-medal");

    expect(medal).toContain("transform: scale(0.98);");
    expect(medal).not.toContain("translate(");
    expect(component).not.toContain('className="dep-realm-aura-frame"');
    expect(component).not.toContain('className="dep-realm-aura"');
    expect(styles).not.toContain(".dep-realm-aura-frame");
    expect(styles).not.toContain(".dep-realm-aura");
});

test("opaque realm artwork is clipped by its circular frame", () => {
    const medalFrame = declarationsFor(".dep-realm-medal-frame");

    expect(medalFrame).toContain("overflow: hidden;");
    expect(medalFrame).toContain("border-radius: 50%;");
});
