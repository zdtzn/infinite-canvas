import { build } from "esbuild";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

// 独立文档隔离三维编辑器的样式；产物按需加载，不进入主站首包。
export function directorStudio(webDir: string): Plugin {
    const id = "virtual:director-studio";
    let config: ResolvedConfig;
    let devBundle: { path: string; source: Uint8Array } | undefined;
    return {
        name: "director-studio",
        configResolved(resolved) { config = resolved; },
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (!devBundle || req.url?.split("?")[0] !== devBundle.path) return next();
                res.setHeader("Content-Type", "text/javascript; charset=utf-8");
                res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
                res.end(devBundle.source);
            });
        },
        resolveId(source) { if (source === id) return `\0${id}`; },
        async load(source) {
            if (source !== `\0${id}`) return;
            const result = await build({
                absWorkingDir: webDir, entryPoints: ["src/features/director-desk/studio/main.tsx"],
                bundle: true, write: false, metafile: true, minify: true, format: "iife", jsx: "automatic", legalComments: "inline",
                outfile: "studio.js", define: { "process.env.NODE_ENV": '"production"' },
            });
            for (const path of Object.keys(result.metafile!.inputs)) this.addWatchFile(resolve(webDir, path));
            const js = result.outputFiles!.find(file => file.path.endsWith(".js"))!.contents;
            const css = result.outputFiles!.find(file => file.path.endsWith(".css"))!.text;
            const hash = createHash("sha256").update(js).digest("hex").slice(0, 16);
            const fileName = `assets/director-studio-${hash}.js`;
            let scriptUrl: string;
            if (config.command === "serve") {
                devBundle = { path: config.base + fileName, source: js };
                scriptUrl = JSON.stringify(devBundle.path);
            } else {
                const ref = this.emitFile({ type: "asset", fileName, source: js });
                scriptUrl = `import.meta.ROLLUP_FILE_URL_${ref}`;
            }
            // srcdoc 继承主页面 CSP；独立的静态脚本才能在生产环境的沙盒内启动。
            const start = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data: blob:; connect-src data: blob:; worker-src blob:"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><div id="root">正在打开导演台…</div><script src="`;
            return `export default ${JSON.stringify(start)} + ${scriptUrl} + '"></script></body></html>';`;
        },
    };
}
