import assert from "node:assert/strict";
import test from "node:test";

import { createAgentLogWriter, redactAgentLog } from "./agent-runtime.js";

test("redactAgentLog masks common credential formats", () => {
    const cases = [
        ["Bearer abc.def-ghi123==", "Bearer [REDACTED]"],
        ["bearer 0123456789abcdef", "bearer [REDACTED]"],
        ["key=sk-abcdefgh1234", "key=[REDACTED]"],
        ["sk-proj-abcdefghijklmnopqrstuvwxyz", "[REDACTED]"],
        ['api_key: "secretvalue123"', "api_key: [REDACTED]"],
        ["token=my-token-abc", "token=[REDACTED]"],
        ["API-KEY: foobar", "API-KEY: [REDACTED]"],
        ["API key: foobar", "API key: [REDACTED]"],
        ["Authorization: Basic YWxhZGRpbjpvcGVuc2VzYW1l", "Authorization: [REDACTED]"],
        ["authorization=Basic abc123; retrying", "authorization=[REDACTED]; retrying"],
    ];
    for (const [input, expected] of cases) assert.equal(redactAgentLog(input), expected);
});

test("stderr writer hides ANSI-colored credentials at every possible chunk boundary", () => {
    const input = "\u001b[31mAuthorization: Basic abc123\u001b[0m\nAPI key: secret\nsk-proj-abcdefgh1234\n";
    for (let boundary = 1; boundary < input.length; boundary++) {
        const messages: string[] = [];
        const writer = createAgentLogWriter((text) => messages.push(text));
        writer.write(input.slice(0, boundary));
        writer.write(input.slice(boundary));
        writer.flush();
        assert.deepEqual(messages, ["Authorization: [REDACTED]\n", "API key: [REDACTED]\n", "[REDACTED]\n"]);
    }
});

test("stderr writer buffers incomplete lines and flushes the last line once", () => {
    const messages: string[] = [];
    const writer = createAgentLogWriter((text) => messages.push(text));
    writer.write("Bearer sec");
    assert.deepEqual(messages, []);
    writer.write("ret");
    writer.flush();
    writer.flush();
    assert.deepEqual(messages, ["Bearer [REDACTED]"]);
});

test("stderr writer strips ANSI before Codex timestamp normalization on each line", () => {
    const messages: string[] = [];
    const writer = createAgentLogWriter((text) => messages.push(text), (text) => text.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+/, ""));
    writer.write("\u001b[2m2026-10-12T10:20:30.000Z\u001b[0m ordinary text\r\n2026-10-12T10:20:31Z token=private\n");
    assert.deepEqual(messages, ["ordinary text\r\n", "token=[REDACTED]\n"]);
});

test("stderr writer clear drops pending content and ordinary messages stay intact", () => {
    const messages: string[] = [];
    const writer = createAgentLogWriter((text) => messages.push(text));
    writer.write("discarded");
    writer.clear();
    writer.write("Codex app-server exited: 0\nmodel: gpt-5");
    writer.flush();
    assert.deepEqual(messages, ["Codex app-server exited: 0\n", "model: gpt-5"]);
});
