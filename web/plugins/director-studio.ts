import { build } from "esbuild";
import { resolve } from "node:path";
import type { Plugin } from "vite";

// 独立文档隔离三维编辑器的样式；产物按需加载，不进入主站首包。
export function directorStudio(webDir: string): Plugin {
    const id = "virtual:director-studio";
    return {
        name: "director-studio",
        resolveId(source) { if (source === id) return `\0${id}`; },
        async load(source) {
            if (source !== `\0${id}`) return;
            const result = await build({
                absWorkingDir: webDir, entryPoints: ["src/features/director-desk/studio/main.tsx"],
                bundle: true, write: false, metafile: true, minify: true, format: "iife", jsx: "automatic", legalComments: "inline",
                outfile: "studio.js", define: { "process.env.NODE_ENV": '"production"' },
            });
            for (const path of Object.keys(result.metafile!.inputs)) this.addWatchFile(resolve(webDir, path));
            const js = result.outputFiles!.find(file => file.path.endsWith(".js"))!.text.replace(/<(\/script|script|!--)/gi, "\\x3C$1");
            const css = result.outputFiles!.find(file => file.path.endsWith(".css"))!.text;
            const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src data: blob:; worker-src blob:"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><div id="root">正在打开导演台…</div><script>${js}</script></body></html>`;
            return `export default ${JSON.stringify(html)};`;
        },
    };
}
