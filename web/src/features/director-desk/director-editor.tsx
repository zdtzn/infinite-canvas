import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { Button } from "antd";
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
import type { DeskAction } from "./lib/desk-messages";
import { flushCanvasPersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";

export default function DirectorEditor({ ctx, onClose }: { ctx: CanvasNodeContext; onClose(): void }) {
    const userId = useUserStore(state => state.user?.id || "");
    const { pathname } = useLocation();
    const openedFor = useRef({ userId, pathname, nodeId: ctx.node.id });
    const container = useRef<HTMLDivElement>(null);
    const latest = useRef({ ctx, onClose });
    latest.current = { ctx, onClose };
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (openedFor.current.userId !== userId || openedFor.current.pathname !== pathname || openedFor.current.nodeId !== ctx.node.id) {
            latest.current.onClose();
            return;
        }
        const nodeId = ctx.node.id;
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
        let writes = Promise.resolve();
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
                    return { scene: node.metadata?.directorScene || null, files };
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
            if (data.ready) { setReady(true); return; }
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
            observer.disconnect();
            port.close();
            frame.onload = null;
            frame.remove();
        };
    }, [ctx.node.id, pathname, userId]);

    return <div className="flex h-full flex-col">
        {!ready && <div className="flex shrink-0 justify-end px-3 py-1"><Button type="text" onPointerDown={event => event.stopPropagation()} onClick={onClose}>关闭导演台</Button></div>}
        <div ref={container} className="min-h-0 flex-1" />
    </div>;
}
