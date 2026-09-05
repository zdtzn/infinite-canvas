import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import ImperialRealm from "./imperial-realm";

for (const preview of [false, true]) {
    test(`imperial ${preview ? "preview" : "homepage"} retains exactly one existing light-rays layer`, () => {
        const html = renderToStaticMarkup(
            <MemoryRouter>
                <ImperialRealm preview={preview} />
            </MemoryRouter>,
        );
        expect(html.match(/light-rays-container/g)).toHaveLength(1);
        expect(html).toContain("homepage-light-rays is-imperial");
        expect(html).toContain("imperial-realm-scene");
        expect(html).toContain("imperial-seal-v1.webp");
    });
}
