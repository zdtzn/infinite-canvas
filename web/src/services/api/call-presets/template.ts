import type { ModelCapability } from "@/stores/use-config-store";

export const CALL_SCRIPT_MARKER = "// infinite-canvas:call-v1";
export function createCallScriptSource(capability: ModelCapability, body: string) {
    return `${CALL_SCRIPT_MARKER}\n// ${capability} 调用预设。入口 main(params)，通过 params.options 读取参数，params.utils 发请求。\nasync function main(params) {\n${body}\n}`;
}
