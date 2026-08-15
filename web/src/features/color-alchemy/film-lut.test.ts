import { describe, expect, test } from "bun:test";

import { loadFilmLut, loadFilmLutCatalog, parseCubeLut, sampleFilmLut, staticFilmLutUrl } from "./film-lut";

const IDENTITY_LUT = `
TITLE "identity"
LUT_3D_SIZE 2
DOMAIN_MIN 0.0 0.0 0.0
DOMAIN_MAX 1.0 1.0 1.0
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;

describe("film LUT", () => {
    test("parses cube metadata and validates the data point count", () => {
        const lut = parseCubeLut(IDENTITY_LUT);
        expect(lut.size).toBe(2);
        expect(lut.domainMin).toEqual([0, 0, 0]);
        expect(lut.domainMax).toEqual([1, 1, 1]);
        expect(lut.data.length).toBe(24);
    });

    test("samples the LUT with trilinear interpolation", () => {
        const lut = parseCubeLut(IDENTITY_LUT);
        const output = sampleFilmLut(lut, 0.25, 0.5, 0.75);
        expect(Array.from(output)).toEqual([0.25, 0.5, 0.75]);
    });

    test("encodes static asset paths without changing directory separators", () => {
        expect(staticFilmLutUrl("luts/instant_consumer/polaroid_px-100uv+_warm_+.cube")).toBe("/film-luts/luts/instant_consumer/polaroid_px-100uv%2B_warm_%2B.cube");
    });

    test("clears failed catalog and LUT requests so a later attempt can retry", async () => {
        const originalFetch = globalThis.fetch;
        let catalogAttempts = 0;
        let lutAttempts = 0;
        globalThis.fetch = (async (input) => {
            const url = String(input);
            if (url === "/film-luts/film_luts.json") {
                catalogAttempts += 1;
                if (catalogAttempts === 1) return new Response("temporary failure", { status: 503 });
                return new Response(
                    JSON.stringify({ filmLUTs: [{ name: "Test LUT", category: "Print", lut_file: "test.cube", thumbnail: "test.jpg" }] }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            }
            lutAttempts += 1;
            if (lutAttempts === 1) return new Response("temporary failure", { status: 503 });
            return new Response(IDENTITY_LUT, { status: 200 });
        }) as typeof fetch;

        try {
            await expect(loadFilmLutCatalog()).rejects.toThrow("胶片滤镜清单加载失败");
            expect(await loadFilmLutCatalog()).toHaveLength(1);
            await expect(loadFilmLut("test.cube")).rejects.toThrow("胶片滤镜加载失败");
            expect((await loadFilmLut("test.cube"))?.size).toBe(2);
            expect(catalogAttempts).toBe(2);
            expect(lutAttempts).toBe(2);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
