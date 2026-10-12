import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveConfigDir, writeConfigFile, type CanvasAgentConfig } from "./config.js";

test("Canvas Agent config supports an isolated directory without changing the default", () => {
    assert.equal(resolveConfigDir("agent-test-config"), path.resolve("agent-test-config"));
    assert.equal(resolveConfigDir(""), path.join(os.homedir(), ".infinite-canvas"));
});

const sample: CanvasAgentConfig = { url: "http://127.0.0.1:17371", token: "test-token" };
const posix = { skip: process.platform === "win32" };

test("writeConfigFile creates private directory and file on POSIX", posix, () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-agent-config-test-"));
    const dir = path.join(base, "nested-config");
    const file = path.join(dir, "canvas-agent.json");
    try {
        writeConfigFile(dir, file, sample);
        assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test("writeConfigFile corrects existing loose POSIX permissions", posix, () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-agent-config-test-"));
    const file = path.join(base, "canvas-agent.json");
    try {
        fs.chmodSync(base, 0o755);
        fs.writeFileSync(file, "{}", { mode: 0o644 });
        writeConfigFile(base, file, sample);
        assert.equal(fs.statSync(base).mode & 0o777, 0o700);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});

test("writeConfigFile preserves config content on all platforms", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-agent-config-test-"));
    const file = path.join(base, "canvas-agent.json");
    try {
        writeConfigFile(base, file, sample);
        assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), sample);
    } finally {
        fs.rmSync(base, { recursive: true, force: true });
    }
});
