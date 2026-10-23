import assert from "node:assert/strict";
import test from "node:test";

import { AGENT_RELEASES_API_URL, agentLaunchCommand, isOlderVersion, selectLatestAgentRelease } from "./distribution.js";
import { logger } from "./utils/logger.js";
import { checkLatestVersions, fetchLatestAgentRelease } from "./version-check.js";

test("启动命令使用当前独立包的固定 Release 资产", () => {
    const command = "npx -y --package=https://github.com/zdtzn/infinite-canvas/releases/download/canvas-agent-v0.7.1/zdtzn-canvas-agent-0.7.1.tgz canvas-agent";
    assert.equal(agentLaunchCommand("0.7.1"), command);
    assert.equal(agentLaunchCommand("0.8.0"), command.replaceAll("0.7.1", "0.8.0"));
});

test("不把无效版本或预发布版本拼入 shell 命令", () => {
    for (const version of ["", "latest", "v0.7.1", "00.7.1", "0.7.1-beta.1", "0.7.1 && echo unsafe", "../latest"]) {
        assert.throws(() => agentLaunchCommand(version), /Invalid Canvas Agent release version/);
    }
});

test("Release 列表选择最高 Agent 稳定版本，不跟随站点最新版或列表顺序", () => {
    const releases = [
        release("0.9.0"),
        { ...release("99.0.0"), tag_name: "v99.0.0" },
        { ...release("99.0.0"), tag_name: "canvas-agent-v99.0.0-beta.1" },
        { ...release("99.0.0"), prerelease: true },
        { ...release("99.0.0"), draft: true },
        release("0.10.1"),
        release("0.10.0"),
        release("0.7.1"),
    ];
    assert.deepEqual(selectLatestAgentRelease(releases), { version: "0.10.1" });
});

test("Agent Release 必须有本仓库匹配版本且上传完成的 tgz 资产", () => {
    const valid = release("0.7.1");
    const invalid = release("99.0.0");
    const asset = invalid.assets[0];
    for (const candidate of [
        { ...invalid, assets: [] },
        { ...invalid, assets: undefined },
        { ...invalid, assets: [{ ...asset, state: "new" }] },
        { ...invalid, assets: [{ ...asset, name: "basketikun-canvas-agent-99.0.0.tgz" }] },
        { ...invalid, assets: [{ ...asset, browser_download_url: asset.browser_download_url.replace("zdtzn/", "upstream/") }] },
        { ...invalid, assets: [{ ...asset, browser_download_url: asset.browser_download_url.replace("99.0.0.tgz", "0.7.1.tgz") }] },
    ]) assert.deepEqual(selectLatestAgentRelease([candidate, valid]), { version: "0.7.1" });
});

test("空列表和无效条目不产生升级，无效 API 响应被拒绝", () => {
    assert.equal(selectLatestAgentRelease([]), undefined);
    assert.equal(selectLatestAgentRelease([null, "invalid", {}, { tag_name: "canvas-agent-v0.7.1" }]), undefined);
    for (const value of [null, "bad json shape", { message: "API rate limit exceeded" }]) {
        assert.throws(() => selectLatestAgentRelease(value), /Invalid GitHub releases response/);
    }
});

test("稳定版按数字比较并拒绝无效版本", () => {
    assert.equal(isOlderVersion("0.9.0", "0.10.0"), true);
    assert.equal(isOlderVersion("0.10.0", "0.9.0"), false);
    assert.equal(isOlderVersion("0.7.1", "0.7.1"), false);
    assert.equal(isOlderVersion("0.7.1", "0.8.0-beta"), false);
    assert.equal(isOlderVersion("invalid", "0.8.0"), false);
});

test("Agent 版本查询使用 GitHub releases 列表和有限超时", async (t) => {
    t.mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
        assert.equal(url, AGENT_RELEASES_API_URL);
        assert.match(String(url), /\/repos\/zdtzn\/infinite-canvas\/releases\?per_page=100$/);
        assert.ok(options?.signal instanceof AbortSignal);
        assert.equal(new Headers(options.headers).get("Accept"), "application/vnd.github+json");
        return new Response(JSON.stringify([release("0.7.1")]));
    });
    assert.deepEqual(await fetchLatestAgentRelease(), { version: "0.7.1" });
});

test("GitHub 非成功状态和无效 JSON 不成为有效升级", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response("", { status: 403 }));
    await assert.rejects(fetchLatestAgentRelease(), /GitHub releases request failed: 403/);
    fetchMock.mock.mockImplementation(async () => new Response("not JSON"));
    await assert.rejects(fetchLatestAgentRelease());
    fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ message: "invalid response" })));
    await assert.rejects(fetchLatestAgentRelease(), /Invalid GitHub releases response/);
});

test("GitHub 检查失败仅警告，Codex 诊断继续且 Agent 命令仍指向本仓库", async (t) => {
    const warnings: string[] = [];
    t.mock.method(logger, "warn", (message: string) => { warnings.push(message); });
    await checkLatestVersions("0.0.1", { agent: async () => { throw new Error("offline"); }, codex: async () => "99.0.0" });
    assert.ok(warnings.some((message) => message.includes("Unable to check Canvas Agent releases on GitHub; startup will continue.")));
    assert.ok(warnings.some((message) => message.includes("local Codex 0.0.1 -> 99.0.0")));
    const bundledWarning = warnings.find((message) => message.includes("bundled Codex"));
    assert.ok(bundledWarning?.includes("github.com/zdtzn/infinite-canvas/releases/download/canvas-agent-v"));
    assert.equal(warnings.some((message) => message.includes("@basketikun") || message.includes("npm view @zdtzn")), false);
});

test("Codex 检查失败仍提示有效 Agent 升级，双失败不会拒绝启动", async (t) => {
    const warnings: string[] = [];
    t.mock.method(logger, "warn", (message: string) => { warnings.push(message); });
    const offline = async () => { throw new Error("offline"); };
    await checkLatestVersions("", { agent: async () => ({ version: "99.0.0" }), codex: offline });
    assert.ok(warnings.some((message) => message.includes(`-> 99.0.0. Run: ${agentLaunchCommand("99.0.0")}`)));
    assert.ok(warnings.some((message) => message.includes("Unable to check the latest Codex npm version; startup will continue.")));
    warnings.length = 0;
    await checkLatestVersions("", { agent: offline, codex: offline });
    assert.equal(warnings.length, 2);
});

function release(version: string) {
    return {
        tag_name: `canvas-agent-v${version}`,
        draft: false,
        prerelease: false,
        assets: [{ name: `zdtzn-canvas-agent-${version}.tgz`, state: "uploaded", browser_download_url: `https://github.com/zdtzn/infinite-canvas/releases/download/canvas-agent-v${version}/zdtzn-canvas-agent-${version}.tgz` }],
    };
}
