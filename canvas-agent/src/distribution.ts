export const AGENT_RELEASES_API_URL = "https://api.github.com/repos/zdtzn/infinite-canvas/releases?per_page=100";
const AGENT_DOWNLOAD_BASE_URL = "https://github.com/zdtzn/infinite-canvas/releases/download";
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export type AgentRelease = { version: string };

/** 使用独立 Agent Release 的固定版本资产启动，避免退回上游 npm 包。 */
export function agentLaunchCommand(version: string) {
    return `npx -y --package=${agentTarballUrl(version)} canvas-agent`;
}

/** 只从包含对应下载资产的 Agent 稳定版中选择最高版本。 */
export function selectLatestAgentRelease(value: unknown): AgentRelease | undefined {
    if (!Array.isArray(value)) throw new Error("Invalid GitHub releases response");
    let latest: AgentRelease | undefined;
    for (const item of value) {
        if (!item || typeof item !== "object") continue;
        const release = item as Record<string, unknown>;
        if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== "string") continue;
        const version = release.tag_name.match(/^canvas-agent-v(\d+\.\d+\.\d+)$/)?.[1];
        if (!version || !STABLE_VERSION.test(version) || !Array.isArray(release.assets)) continue;
        const assetUrl = agentTarballUrl(version);
        const hasAsset = release.assets.some((asset: unknown) => {
            if (!asset || typeof asset !== "object") return false;
            const candidate = asset as Record<string, unknown>;
            return candidate.name === `zdtzn-canvas-agent-${version}.tgz` && candidate.state === "uploaded" && candidate.browser_download_url === assetUrl;
        });
        if (hasAsset && (!latest || isOlderVersion(latest.version, version))) latest = { version };
    }
    return latest;
}

/** 比较仅包含数字段的稳定版语义版本。 */
export function isOlderVersion(current: string, latest: string) {
    if (!STABLE_VERSION.test(current) || !STABLE_VERSION.test(latest)) return false;
    const left = current.split(".").map(Number);
    const right = latest.split(".").map(Number);
    for (let index = 0; index < left.length; index++) {
        if (left[index] !== right[index]) return left[index] < right[index];
    }
    return false;
}

function agentTarballUrl(version: string) {
    if (!STABLE_VERSION.test(version)) throw new Error("Invalid Canvas Agent release version");
    return `${AGENT_DOWNLOAD_BASE_URL}/canvas-agent-v${version}/zdtzn-canvas-agent-${version}.tgz`;
}
