import assert from "node:assert/strict";
import { test } from "node:test";

import { taskProgressProps } from "./task-progress";

test("uses indeterminate progress for active image jobs", () => {
    assert.deepEqual(taskProgressProps("queued"), { status: "active" });
    assert.deepEqual(taskProgressProps("running"), { status: "active" });
});

test("does not render progress for terminal jobs", () => {
    assert.equal(taskProgressProps("succeeded"), null);
    assert.equal(taskProgressProps("failed"), null);
    assert.equal(taskProgressProps("canceled"), null);
});
