import assert from "node:assert/strict";
import { test } from "node:test";

import { promptOptimizerSelectionValue, promptOptimizerTargetFromSelection } from "./prompt-optimizer-admin-setting";

test("administrator prompt optimizer selection round-trips without using user preferences", () => {
    const target = { channelId: "managed", model: "text-primary" };
    const value = promptOptimizerSelectionValue(target);

    assert.deepEqual(promptOptimizerTargetFromSelection(value), target);
    assert.equal(promptOptimizerTargetFromSelection(promptOptimizerSelectionValue(null)), null);
    assert.equal(promptOptimizerTargetFromSelection("invalid-selection"), undefined);
});
