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

test("current realm raster layers are optically centered", () => {
    expect(declarationsFor(".dep-journey-grid li.is-current .dep-realm-aura")).toContain("transform: translate(0.08rem, -0.06rem) scale(1.03);");
    expect(declarationsFor(".dep-journey-grid li.is-current .dep-realm-medal")).toContain("transform: translate(-0.18rem, 0.05rem) scale(0.98);");
});
