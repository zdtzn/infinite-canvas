import { Home, ImagePlus, Library, Pencil } from "lucide-react";
import { Button } from "antd";
import { Link } from "react-router-dom";

import { useImperialMode } from "@/features/cultivation/imperial-mode";
import { cn } from "@/lib/utils";

export default function NotFound() {
    const { isImperialMode } = useImperialMode();

    return (
        <div className={cn("flex h-dvh flex-col overflow-hidden bg-background text-foreground", isImperialMode && "imperial-not-found")}>
            <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-background bg-[radial-gradient(rgba(120,113,108,.18)_1px,transparent_1px)] px-6 py-10 text-stone-900 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)] dark:text-stone-100">
                <section className="w-full max-w-md text-center">
                    <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-lg border border-stone-200 bg-white text-2xl font-semibold shadow-sm dark:border-stone-800 dark:bg-stone-900">404</div>
                    <h1 className="text-3xl font-semibold tracking-normal">
                        {isImperialMode ? (
                            <>
                                诸天万界，
                                <br />
                                竟无此页。
                            </>
                        ) : (
                            "页面不存在"
                        )}
                    </h1>
                    <p className="mt-3 text-sm leading-6 text-stone-500 dark:text-stone-400">{isImperialMode ? "此处未留画卷，请返回已开启的世界。" : "这个地址没有对应的页面，可能已经移动或被合并到其他入口。"}</p>
                    <div className="mt-8 flex flex-wrap justify-center gap-3">
                        <Link to="/">
                            <Button type="primary" icon={<Home className="size-4" />}>
                                返回首页
                            </Button>
                        </Link>
                        <Link to="/canvas">
                            <Button icon={<Pencil className="size-4" />}>我的画布</Button>
                        </Link>
                        <Link to="/image">
                            <Button icon={<ImagePlus className="size-4" />}>生图工作台</Button>
                        </Link>
                        <Link to="/assets">
                            <Button icon={<Library className="size-4" />}>我的资产</Button>
                        </Link>
                    </div>
                </section>
            </main>
        </div>
    );
}
