import { expect, test } from "bun:test";
import { localEditPrompt, localEditRatio, selectionBounds, type EditRegion } from "./local-image-edit";

test("numbered notes stay attached to their own image-relative regions", () => {
    const regions: EditRegion[] = [
        { id: "sky", selection: { mode: "box", start: { x: 0.4, y: 0.3 }, end: { x: 0.2, y: 0.1 } }, note: " 改成浅蓝色 " },
        { id: "corner", selection: { mode: "brush", points: [{ x: 0.9, y: 0.95 }], diameter: 0.2 }, note: "擦除污渍" },
    ];
    const size = { width: 800, height: 400 };
    const bounds = selectionBounds(regions[1].selection, size);
    expect(bounds.right).toBeCloseTo(0.95);
    expect(bounds.bottom).toBe(1);
    const prompt = localEditPrompt(regions, size, true);
    expect(prompt).toContain("图片2");
    expect(prompt).toContain("区域 1（横向 20.0%–40.0%，纵向 10.0%–30.0%）：改成浅蓝色");
    expect(prompt).toContain("区域 2（横向 85.0%–95.0%，纵向 85.0%–100.0%）：擦除污渍");
    expect(localEditPrompt(regions.slice(0, 1), size, false)).not.toContain("图片2");
});

test("edit output uses the closest supported ratio even for odd-sized source photos", () => {
    expect(localEditRatio(1253, 1254, ["1:1", "3:2", "2:3"])).toBe("1:1");
    expect(localEditRatio(2100, 840, ["1:1", "4:3", "16:9"])).toBe("16:9");
    expect(localEditRatio(700, 1054, ["auto", "1:1", "2:3", "9:16"])).toBe("2:3");
});
