import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveConfigDir } from "./config.js";

test("Canvas Agent config supports an isolated directory without changing the default", () => {
    assert.equal(resolveConfigDir("agent-test-config"), path.resolve("agent-test-config"));
    assert.equal(resolveConfigDir(""), path.join(os.homedir(), ".infinite-canvas"));
});
