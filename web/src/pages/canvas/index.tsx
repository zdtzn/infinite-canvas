import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { App, Button } from "antd";
import { Download, FileUp, Plus } from "lucide-react";

import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { useImperialLoadingText } from "@/features/cultivation/imperial-mode";
import { readCreativeImageTransfer } from "@/lib/creative-image-transfer";

export default function CanvasPage() {
    const { message } = App.useApp();
    const location = useLocation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const loadingLabel = useImperialLoadingText("正在加载画布...", "canvas-list");

    const mode = searchParams.get("mode");
    const imageTransfer = readCreativeImageTransfer(location.state);
    const transferMode = mode === "transfer" && Boolean(imageTransfer);
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        navigate(`/canvas/${id}${agentQuery}`, imageTransfer ? { state: location.state } : undefined);
    };
    const createAndEnter = () => enterProject(createProject(`无限画布 ${projects.length + 1}`));
    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const { readZip } = await import("@/lib/zip");
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            await Promise.all(
                data.projects.flatMap((project) =>
                    project.files.map(async (item) => {
                        const blob = zip.get(item.path);
                        if (!blob) return;
                        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
                        await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
                    }),
                ),
            );
            data.projects.forEach((item) => importProject(item.project));
            message.success(`已导入 ${data.projects.length} 个画布`);
        } catch (error) {
            message.error(error instanceof Error ? `导入失败：${error.message}` : "导入失败，请选择有效的画布压缩包");
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    const exportSelectedProjects = async () => {
        const { exportCanvasProjects } = await import("@/lib/canvas/canvas-export");
        await exportCanvasProjects(
            projects.filter((project) => selectedIds.includes(project.id)),
            `无限画布-${selectedIds.length}个项目`,
        );
    };

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent" && !transferMode)) return;
        autoOpenRef.current = true;
        enterProject(mode === "new" ? createProject(`无限画布 ${projects.length + 1}`) : projects[0]?.id || createProject(`无限画布 ${projects.length + 1}`));
    }, [createProject, hydrated, mode, projects, transferMode]);

    if (hydrated && (mode === "new" || mode === "recent" || transferMode)) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">正在打开画布...</main>;

    return (
        <main className="h-full overflow-auto bg-background text-foreground">
            {/* ── 洞天 · 场景阁头(仅 UI,逻辑不变) ── */}
            <section className="relative overflow-hidden">
                <img src="/images/ref/energy-vortex-1.webp" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-b from-[#0e0e12]/80 via-[#0e0e12]/60 to-[#0e0e12]" aria-hidden />
                <div className="relative mx-auto flex w-full max-w-6xl flex-wrap items-end justify-between gap-4 px-6 pb-10 pt-14">
                    <div>
                        <p className="shj-hero-eyebrow">Dong Tian</p>
                        <h1 className="font-brush mt-4 text-5xl text-[#edede6] [text-shadow:0_2px_24px_rgb(0_0_0/0.6)] sm:text-6xl">洞天</h1>
                        <p className="font-display mt-3 text-sm tracking-[0.15em] text-[#edede6]/70">{projects.length ? `${projects.length} 方天地,各自生长` : "一方属于你的天地,由此而开"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {selectedIds.length ? (
                            <>
                                <Button disabled={!hydrated} icon={<Download className="size-4" />} onClick={() => void exportSelectedProjects()}>
                                    导出选中
                                </Button>
                                <Button disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>
                                    删除选中
                                </Button>
                            </>
                        ) : null}
                        {projects.length ? (
                            <Button disabled={!hydrated} onClick={() => setDeleteIds(projects.map((project) => project.id))}>
                                删除全部
                            </Button>
                        ) : null}
                        <Button disabled={!hydrated} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                            导入画布
                        </Button>
                        <Button disabled={!hydrated} type="primary" icon={<Plus className="size-4" />} onClick={createAndEnter}>
                            新建画布
                        </Button>
                    </div>
                </div>
            </section>

            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                {!hydrated ? (
                    <section className="imperial-route-loading flex min-h-[360px] items-center justify-center border-y border-[rgb(237_237_230/0.1)] text-sm text-[#8a8a96]">{loadingLabel}</section>
                ) : projects.length ? (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {projects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                    </div>
                ) : (
                    <section className="flex min-h-[360px] flex-col items-center justify-center border-y border-[rgb(237_237_230/0.1)] text-center">
                        <h2 className="font-brush text-3xl text-[#edede6]">洞天未开</h2>
                        <p className="font-display mt-3 text-sm tracking-[0.1em] text-[#8a8a96]">新建一个画布,便可独辟一方天地,节点、连线皆由你定。</p>
                        <button
                            type="button"
                            onClick={createAndEnter}
                            className="shj-cta-glow mt-8 inline-flex items-center gap-2 rounded-md bg-[#d8402a] px-7 py-3.5 text-sm font-medium tracking-[0.2em] text-[#fff7ee] transition-colors duration-300 hover:bg-[#ee5038]"
                        >
                            <Plus className="size-4" />
                            开辟洞天
                        </button>
                    </section>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}
