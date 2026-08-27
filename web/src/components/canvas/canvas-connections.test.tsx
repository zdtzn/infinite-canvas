import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ConnectionPath } from "./canvas-connections";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

const connection: CanvasConnection = {
    id: "connection-1",
    fromNodeId: "from",
    toNodeId: "to",
};

const from = {
    id: "from",
    position: { x: 20, y: 40 },
    width: 240,
    height: 160,
} as CanvasNodeData;

const to = {
    id: "to",
    position: { x: 620, y: 180 },
    width: 240,
    height: 160,
} as CanvasNodeData;

function renderConnection(active: boolean) {
    return renderToStaticMarkup(
        <svg>
            <ConnectionPath connection={connection} from={from} to={to} active={active} onSelect={() => undefined} />
        </svg>,
    );
}

test("selected canvas connections use the cyan-to-blue gradient", () => {
    const markup = renderConnection(true);

    expect(markup).toContain("<linearGradient");
    expect(markup).toContain('stop-color="#22d3ee"');
    expect(markup).toContain('stop-color="#2563eb"');
    expect(markup).toContain("drop-shadow(0 0 5px rgba(34, 211, 238, 0.42))");
});

test("unselected canvas connections keep the muted solid stroke", () => {
    const markup = renderConnection(false);

    expect(markup).not.toContain("<linearGradient");
    expect(markup).not.toContain("drop-shadow");
});
