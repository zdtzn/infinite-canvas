import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRouteWarmupOrder } from "./route-loaders";

test("warms Wen Dao Tai before heavier workspaces", () => {
    assert.equal(buildRouteWarmupOrder("/")[0]?.route, "/chat");
    assert.deepEqual(
        buildRouteWarmupOrder("/image")
            .slice(0, 3)
            .map((target) => target.route),
        ["/chat", "/canvas", "/assets"],
    );
});

test("does not warm the workspace that is already open", () => {
    assert.ok(!buildRouteWarmupOrder("/chat").some((target) => target.route === "/chat"));
    assert.equal(buildRouteWarmupOrder("/chat")[0]?.route, "/canvas");
});

test("bounds idle warmup while leaving all routes available on intent", () => {
    const order = buildRouteWarmupOrder("/").map((target) => target.route);
    assert.equal(order.length, 3);
    assert.ok(!order.includes("/image"));
    assert.ok(!order.includes("/product-lab"));
});
