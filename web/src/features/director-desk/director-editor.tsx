import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { App, Button, InputNumber, Modal, Select, Space } from "antd";
import { nanoid } from "nanoid";
import studioDocument from "virtual:director-studio";
import { useUserStore } from "@/stores/use-user-store";
import { fetchServerResource } from "@/services/server-api";
import { getImageBlob, uploadImage } from "@/services/image-storage";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { imageMetadata, videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasNodeContext } from "@/types/canvas-plugin";
import { sceneSummarySchema, type SceneSummary } from "./api/camera-layouts";
import type { DeskAction } from "./lib/desk-messages";
import { createOrbitLayout } from "./api/orbit";
import { flushCanvasPersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";

export default function DirectorEditor({ ctx, onClose }: { ctx: CanvasNodeContext; onClose(): void }) {
    const { message } = App.useApp();
    const userId = useUserStore(state => state.user?.id || "");
    const { pathname } = useLocation();
    const openedFor = useRef({ userId, pathname, nodeId: ctx.node.id });
    const container = useRef<HTMLDivElement>(null);
    const latest = useRef({ ctx, onClose });
    latest.current = { ctx, onClose };
    const layoutRequest = useRef<((action: object) => Promise<unknown>) | undefined>(undefined);
    const [scene, setScene] = useState<SceneSummary | null>(null);
    const [target, setTarget] = useState<string>();
    const [distance, setDistance] = useState(8);
    const [height, setHeight] = useState(2);
    const [count, setCount] = useState(4);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (openedFor.current.userId !== userId || openedFor.current.pathname !== pathname || openedFor.current.nodeId !== ctx.node.id) {
            latest.current.onClose();
            return;
        }
        const nodeId = ctx.node.id;
        const sceneId = `${pathname}:${nodeId}`;
        const controller = new AbortController();
        const active = () => {
            controller.signal.throwIfAborted();
            if ((useUserStore.getState().user?.id || "") !== userId || window.location.pathname !== pathname) throw new Error("所属账号或画布已变更");
            const node = latest.current.ctx.getNode(nodeId);
            if (!node) throw new Error("导演台节点已移除");
            return node;
        };
        const frame = document.createElement("iframe");
        frame.title = "3D 导演台";
        frame.setAttribute("sandbox", "allow-scripts allow-downloads");
        frame.style.cssText = "display:block;width:100%;height:100%;border:0";
        const channel = new MessageChannel();
        const port = channel.port1;
        const knownAttachments = new Map((ctx.node.metadata?.attachments || []).map(item => [item.slot, item]));
        const pending = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout> }>();
        let writes = Promise.resolve();
        const request = (action: object) => new Promise<unknown>((resolve, reject) => {
            active();
            const requestId = nanoid();
            const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("导演台暂未响应，请稍后重试")); }, 15_000);
            pending.set(requestId, { resolve, reject, timer });
            port.postMessage({ ...action, requestId, sceneId });
        });
        layoutRequest.current = request;
        async function handle(data: DeskAction) {
            const node = active();
            switch (data.action) {
                case "load": {
                    const files = await Promise.all((node.metadata?.attachments || []).map(async item => {
                        const file = await getMediaBlob(item.storageKey, userId);
                        if (!file) throw new Error("场景素材无法读取，请重试");
                        return { key: item.slot, file };
                    }));
                    active();
                    return { sceneId, scene: node.metadata?.directorScene || null, files };
                }
                case "save": {
                    writes = writes.catch(() => {}).then(async () => {
                        for (const item of active().metadata?.attachments || []) knownAttachments.set(item.slot, item);
                        if (data.added.length > 200 || data.scene.keys.length > 500) throw new Error("场景素材过多，请分开保存");
                        for (const item of data.added) {
                            if (knownAttachments.has(item.key)) continue;
                            const stored = await uploadMediaFile(item.file, "file", userId);
                            active();
                            knownAttachments.set(item.key, { slot: item.key, storageKey: stored.storageKey });
                        }
                        const keys = new Set(data.scene.keys);
                        if ([...keys].some(key => !knownAttachments.has(key))) throw new Error("场景素材尚未保存，请重试");
                        active();
                        latest.current.ctx.updateMetadata({ directorScene: data.scene, attachments: [...knownAttachments.values()].filter(item => keys.has(item.slot)) });
                        // 等画布 effect 写入项目，再确认本机持久化成功；云端沿用原画布同步。
                        const projectId = pathname.split("/").pop();
                        const deadline = performance.now() + 3000;
                        while (!useCanvasStore.getState().projects.find(project => project.id === projectId)?.nodes.some(item => item.id === nodeId && item.metadata?.directorScene === data.scene)) {
                            active();
                            if (performance.now() > deadline) throw new Error("画布尚未保存，请重试");
                            await new Promise(resolve => setTimeout(resolve, 20));
                        }
                        await flushCanvasPersistence(true);
                        active();
                    });
                    return writes;
                }
                case "background": {
                    const image = latest.current.ctx.getUpstream().find(item => item.type === CanvasNodeType.Image && item.metadata?.content);
                    if (!image) throw new Error("请先连接一张图片作为全景背景");
                    const file = image.metadata?.storageKey ? await getImageBlob(image.metadata.storageKey, userId) : await (await fetchServerResource(image.metadata!.content!, { signal: controller.signal }, userId)).blob();
                    active();
                    if (!file) throw new Error("图片暂时无法读取");
                    return { file, name: image.title };
                }
                case "captures":
                case "recording": {
                    const items = data.action === "captures" ? data.items : [data];
                    if (!items.length || items.length > 24) throw new Error("一次最多添加 24 张分镜");
                    const prepared = await Promise.allSettled(items.map(async item => {
                        const image = data.action === "captures";
                        const stored = image ? await uploadImage(item.file, { expectedUserId: userId }) : await uploadMediaFile(item.file, "video", userId);
                        return { item, image, stored };
                    }));
                    active();
                    const failed = prepared.find(item => item.status === "rejected");
                    if (failed?.status === "rejected") throw failed.reason;
                    const ops: CanvasAgentOp[] = [];
                    let y = node.position.y;
                    for (const result of prepared) {
                        if (result.status !== "fulfilled") continue;
                        const { item, image, stored } = result.value;
                        const id = nanoid();
                        const width = 340;
                        const size = { width, height: width * ((stored.height || 180) / (stored.width || 320)) };
                        const x = node.position.x + node.width + 96;
                        while (latest.current.ctx.getNodes().some(other => other.position.x < x + size.width && other.position.x + other.width > x && other.position.y < y + size.height && other.position.y + other.height > y)) y += size.height + 24;
                        const metadata = image ? imageMetadata(stored as Awaited<ReturnType<typeof uploadImage>>) : videoMetadata(stored);
                        ops.push({ type: "add_node", id, nodeType: image ? CanvasNodeType.Image : CanvasNodeType.Video, title: item.name, position: { x, y }, ...size, metadata });
                        ops.push({ type: "connect_nodes", fromNodeId: nodeId, toNodeId: id });
                        y += size.height + 24;
                    }
                    active();
                    latest.current.ctx.applyOps(ops);
                    return;
                }
                case "close": latest.current.onClose(); return;
            }
        }
        port.onmessage = async ({ data }) => {
            if (controller.signal.aborted) return;
            if (data.requestId) {
                const waiter = pending.get(data.requestId);
                if (!waiter || data.sceneId !== sceneId) return;
                pending.delete(data.requestId);
                clearTimeout(waiter.timer);
                if (data.ok) waiter.resolve(data.value);
                else waiter.reject(new Error("镜头布局未完成，请重试"));
                return;
            }
            if (data.ready) return;
            try {
                const value = await handle(data);
                if (!controller.signal.aborted) port.postMessage({ id: data.id, ok: true, value });
            } catch {
                if (!controller.signal.aborted) port.postMessage({ id: data.id, ok: false });
            }
        };
        const theme = () => {
            const palette = latest.current.ctx.theme;
            port.postMessage({ theme: document.documentElement.classList.contains("dark") ? "dark" : "light", colors: { background: palette.node.panel, surface: palette.node.fill, panel: palette.node.panel, border: palette.node.stroke, text: palette.node.text, muted: palette.node.muted, accent: palette.node.activeStroke } });
        };
        const observer = new MutationObserver(theme);
        frame.onload = () => { frame.contentWindow?.postMessage("director-desk:open", "*", [channel.port2]); theme(); };
        frame.srcdoc = studioDocument;
        container.current!.append(frame);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
        return () => {
            controller.abort();
            layoutRequest.current = undefined;
            for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new DOMException("已关闭", "AbortError")); }
            observer.disconnect();
            port.close();
            frame.onload = null;
            frame.remove();
        };
    }, [ctx.node.id, pathname, userId]);

    const readTargets = async () => {
        try {
            const next = sceneSummarySchema.parse(await layoutRequest.current?.({ action: "summary" }));
            setScene(next);
            setTarget(next.objects.find(item => item.visible && item.focusTarget)?.id);
        } catch { message.error("场景暂未就绪，请稍后重试"); }
    };
    const addOrbit = async () => {
        if (!target) return;
        setBusy(true);
        try {
            const current = sceneSummarySchema.parse(await layoutRequest.current?.({ action: "summary" }));
            await layoutRequest.current?.({ action: "apply-layout", result: createOrbitLayout(current, target, distance, height, count) });
            setScene(null);
            message.success(`已添加 ${count} 个环绕机位`);
        } catch { message.error("镜头布局未完成，请确认对象仍存在后重试"); }
        finally { setBusy(false); }
    };
    return <div className="flex h-full flex-col">
        <div className="flex shrink-0 justify-end px-3 py-1"><Button type="text" onClick={() => void readTargets()}>环绕镜头布局</Button></div>
        <div ref={container} className="min-h-0 flex-1" />
        <Modal title="环绕目标添加镜头" open={Boolean(scene)} onCancel={() => !busy && setScene(null)} onOk={() => void addOrbit()} confirmLoading={busy} okButtonProps={{ disabled: !target }} okText="添加镜头" cancelText="取消">
            <Space orientation="vertical" className="w-full">
                <Select aria-label="镜头目标" className="w-full" value={target} onChange={setTarget} options={scene?.objects.filter(item => item.visible && item.focusTarget).map(item => ({ value: item.id, label: item.name }))} />
                <label>距离 <InputNumber aria-label="镜头距离" min={0.1} max={1000} value={distance} onChange={value => setDistance(value || 8)} /></label>
                <label>相对高度 <InputNumber aria-label="相对高度" min={-1000} max={1000} value={height} onChange={value => setHeight(value ?? 2)} /></label>
                <label>镜头数量 <InputNumber aria-label="镜头数量" min={1} max={24} precision={0} value={count} onChange={value => setCount(value || 4)} /></label>
            </Space>
        </Modal>
    </div>;
}
