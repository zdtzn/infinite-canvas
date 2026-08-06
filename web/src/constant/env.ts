export const APP_VERSION = __APP_VERSION__ || "dev";

export const REPOSITORY_URL = "https://github.com/zdtzn/infinite-canvas";
export const RAW_REPOSITORY_URL = "https://raw.githubusercontent.com/zdtzn/infinite-canvas/main";

export const DOCS_URL = import.meta.env.VITE_DOC_URL || "/docs";

// 官方插件清单由当前仓库 CI 发布到 plugins-dist 分支；可用环境变量覆盖为其他可信来源。
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "https://cdn.jsdelivr.net/gh/zdtzn/infinite-canvas@plugins-dist/official-plugins.json";
