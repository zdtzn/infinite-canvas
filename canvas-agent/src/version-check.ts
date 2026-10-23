import { execFile, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

import { VERSION } from "./config.js";
import { AGENT_RELEASES_API_URL, agentLaunchCommand, isOlderVersion, selectLatestAgentRelease } from "./distribution.js";
import { logger } from "./utils/logger.js";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const CODEX_VERSION = String((require("@openai/codex/package.json") as { version: string }).version);

export type VersionStatus = {
    agent: string;
    bundledCodex: string;
    localCodex: string;
    compatible: boolean;
};

/** 返回可展示给连接诊断页的版本信息，不触发网络检查。 */
export function getVersionStatus(): VersionStatus {
    const localCodex = commandVersion("codex");
    return {
        agent: VERSION,
        bundledCodex: CODEX_VERSION,
        localCodex,
        compatible: !localCodex || localCodex === CODEX_VERSION,
    };
}

/** 输出当前版本，并在后台检查 Agent Release 和 Codex npm 版本。 */
export function checkVersions() {
    const versions = getVersionStatus();
    const localCodexVersion = versions.localCodex;
    logger.info("Canvas Agent version", { version: VERSION });
    logger.info("Bundled Codex version", { version: CODEX_VERSION });
    logger.info("Local Codex version", { version: localCodexVersion || "not found" });
    if (!localCodexVersion) {
        logger.warn("Local Codex was not found. Install the latest version with: npm install -g @openai/codex@latest");
    } else if (localCodexVersion !== CODEX_VERSION) {
        logger.warn(`Bundled Codex ${CODEX_VERSION} does not match local Codex ${localCodexVersion}. Keep both current with: npm install -g @openai/codex@latest && ${agentLaunchCommand(VERSION)}`);
    }
    void checkLatestVersions(localCodexVersion);
}

/** 分别检查 Agent Release 和 Codex，任何检查失败都不影响启动。 */
export async function checkLatestVersions(localCodexVersion: string, checks = { agent: fetchLatestAgentRelease, codex: () => npmVersion("@openai/codex") }) {
    const [agentResult, codexResult] = await Promise.allSettled([checks.agent(), checks.codex()]);
    const latestAgent = agentResult.status === "fulfilled" ? agentResult.value : undefined;
    if (agentResult.status === "rejected") logger.warn("Unable to check Canvas Agent releases on GitHub; startup will continue.");
    if (latestAgent && isOlderVersion(VERSION, latestAgent.version)) logger.warn(`Update available: Canvas Agent ${VERSION} -> ${latestAgent.version}. Run: ${agentLaunchCommand(latestAgent.version)}`);
    if (codexResult.status === "rejected") {
        logger.warn("Unable to check the latest Codex npm version; startup will continue.");
        return;
    }
    const latestCodex = codexResult.value;
    if (isOlderVersion(CODEX_VERSION, latestCodex)) logger.warn(`Update available: bundled Codex ${CODEX_VERSION} -> ${latestCodex}. Upgrade Canvas Agent with: ${agentLaunchCommand(latestAgent?.version || VERSION)}`);
    if (localCodexVersion && isOlderVersion(localCodexVersion, latestCodex)) logger.warn(`Update available: local Codex ${localCodexVersion} -> ${latestCodex}. Run: npm install -g @openai/codex@latest`);
}

/** GitHub 列表包含站点 Release，只接受独立 Agent 的稳定版下载。 */
export async function fetchLatestAgentRelease() {
    const response = await fetch(AGENT_RELEASES_API_URL, {
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "infinite-canvas-agent" },
        signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`GitHub releases request failed: ${response.status}`);
    return selectLatestAgentRelease(await response.json());
}

/** 读取本机命令输出中的语义版本号。 */
function commandVersion(command: string) {
    try {
        return execFileSync(command, ["--version"], { encoding: "utf8", timeout: 5_000 }).match(/\d+\.\d+\.\d+/)?.[0] || "";
    } catch {
        return "";
    }
}

/** 读取 npm 包的最新版本。 */
async function npmVersion(name: string) {
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const { stdout } = await execFileAsync(command, ["view", name, "version"], { encoding: "utf8", timeout: 10_000 });
    return stdout.trim();
}
