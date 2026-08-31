import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

describe("Color adjustment slider responsiveness", () => {
    test("keeps an immediate local value while parent updates are frame-batched", () => {
        const source = readFileSync(new URL("./color-adjustment-row.tsx", import.meta.url), "utf8");

        assert.match(source, /const \[sliderValue, setSliderValue\] = useState\(value\)/);
        assert.match(source, /setSliderValue\(next\)/);
        assert.match(source, /<Slider[^>]+value=\{sliderValue\}/s);
    });
});
