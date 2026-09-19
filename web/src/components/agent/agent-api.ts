import type { CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";

type AgentConfigResponse = { ok?: boolean; url?: string; token?: string; hasToken?: boolean };

export type AgentDiagnostics = {
    ok: boolean;
    origin: { current: string; authorized: boolean; authorizedCount: number };
    versions: { agent: string; bundledCodex: string; localCodex: string; compatible: boolean };
    session: { ok: boolean; hasCanvas: boolean; clients: number; codexBusy: boolean; activeClient: boolean; boundClient: boolean; codex: { busy: boolean; threadId: string; turnId: string } };
};

export class AgentApiError extends Error {
    constructor(message: string, public readonly status: number, public readonly code?: string) {
        super(message);
        this.name = "AgentApiError";
    }
}

export async function postState(endpoint: string, token: string, clientId: string, snapshot: CanvasAgentSnapshot | null) {
    try {
        await fetch(`${endpoint}/canvas/state?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(snapshot ? { ...snapshot, hasCanvas: true } : { hasCanvas: false }),
        });
    } catch {}
}

export async function activateAgentClient(endpoint: string, token: string, clientId: string) {
    try {
        await fetch(`${endpoint}/canvas/activate?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`, { method: "POST" });
    } catch {}
}

export async function postToolResult(endpoint: string, token: string, clientId: string, body: { requestId: string; result?: unknown; error?: string }) {
    await fetch(`${endpoint}/canvas/result?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export async function postCodexApproval(endpoint: string, token: string, requestId: string, decision: "accept" | "acceptForSession" | "decline") {
    await fetchAgentJson(endpoint, token, "/agent/codex/approval", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, decision }) });
}

export async function revealAgentLocalFile(endpoint: string, token: string, path: string) {
    await fetchAgentJson(endpoint, token, "/agent/local-file/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
}

export async function fetchAgentJson<T>(endpoint: string, token: string, path: string, init?: RequestInit) {
    const url = `${endpoint}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
    let res: Response;
    try {
        res = await fetch(url, init);
    } catch (error) {
        throw new AgentApiError(error instanceof Error ? error.message : "无法访问本地 Agent", 0, "NETWORK_ERROR");
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; msg?: string };
    if (!res.ok) throw new AgentApiError(data.error || data.msg || "本地 Agent 请求失败", res.status);
    return data;
}

export function fetchAgentDiagnostics(endpoint: string, token: string) {
    return fetchAgentJson<AgentDiagnostics>(endpoint, token, "/diagnostics");
}

export function resetAgentOrigin(endpoint: string, token: string) {
    return fetchAgentJson<{ ok: boolean; origin: string; authorized: boolean }>(endpoint, token, "/diagnostics/origin/reset", { method: "POST" });
}

export async function discoverAgentConfig(endpoint: string) {
    try {
        const res = await fetch(`${endpoint}/config`);
        if (!res.ok) return null;
        const data = (await res.json()) as AgentConfigResponse;
        return data.ok ? data : null;
    } catch {
        return null;
    }
}
