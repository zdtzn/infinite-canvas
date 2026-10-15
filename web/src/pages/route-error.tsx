import { Button } from "antd";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";

import { isChunkLoadError } from "@/lib/lazy-route";

export default function RouteErrorPage() {
    const error = useRouteError();
    const chunkFailure = isChunkLoadError(error);
    const detail = routeErrorMessage(error);

    return (
        <main className="grid min-h-dvh place-items-center bg-stone-50 px-5 py-10 text-stone-950 dark:bg-stone-950 dark:text-stone-50">
            <section className="w-full max-w-md text-center">
                <span className="mx-auto grid size-12 place-items-center rounded-lg border border-stone-200 bg-white text-stone-700 shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200">
                    <AlertTriangle className="size-5" />
                </span>
                <h1 className="mt-5 text-2xl font-semibold">页面暂时无法显示</h1>
                <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400" role="alert">{chunkFailure ? "页面需要更新，请重新加载后继续。" : "请重新加载页面，或返回首页继续。"}</p>
                {detail ? (
                    <details className="mt-3 text-left text-xs leading-5 text-stone-500 dark:text-stone-400">
                        <summary className="min-h-11 cursor-pointer py-3 text-center">查看详情</summary>
                        <p className="max-h-40 overflow-y-auto break-words rounded-md bg-stone-100 px-3 py-2 dark:bg-stone-900">{detail}</p>
                    </details>
                ) : null}
                <div className="mt-6 flex justify-center gap-3">
                    <Button type="primary" icon={<RefreshCw className="size-4" />} onClick={() => window.location.reload()}>
                        重新加载
                    </Button>
                    <Button icon={<Home className="size-4" />} onClick={() => window.location.assign("/")}>
                        返回首页
                    </Button>
                </div>
            </section>
        </main>
    );
}

function routeErrorMessage(error: unknown) {
    if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText || "请求失败"}`;
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    return message.slice(0, 240);
}
