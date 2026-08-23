import { Modal } from "antd";
import { ArrowRight, GitCompare } from "lucide-react";

import { canvasImageDisplaySource } from "@/lib/canvas/canvas-image-loading";
import { useThemeStore } from "@/stores/use-theme-store";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";

export function CanvasVersionCompareDialog({ nodes, open, onClose }: { nodes: CanvasNodeData[]; open: boolean; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <Modal title={<span className="inline-flex items-center gap-2"><GitCompare className="size-4" />版本比较</span>} open={open} onCancel={onClose} footer={null} width={980} centered destroyOnHidden>
            <div className="grid gap-4 md:grid-cols-2">
                {nodes.map((node) => (
                    <div key={node.id} className="min-w-0">
                        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                            <span className="min-w-0 truncate font-medium" title={node.title}>{node.title || "未命名版本"}</span>
                            <span className="shrink-0 text-xs opacity-55">{node.metadata?.isPrimaryVersion ? "主版本" : node.metadata?.versionLabel || "版本"}</span>
                        </div>
                        <div className="grid aspect-square place-items-center overflow-hidden rounded-xl border" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                            {node.metadata?.content ? <img src={canvasImageDisplaySource(node.metadata, true)} alt={node.title} className="block size-full object-contain" /> : <span className="text-xs opacity-50">暂无图片</span>}
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-xs opacity-60">
                            <span>{Math.round(node.metadata?.naturalWidth || node.width)} × {Math.round(node.metadata?.naturalHeight || node.height)}</span>
                            {node.metadata?.derivedFromNodeId ? <><ArrowRight className="size-3" /><span>基于其他节点</span></> : null}
                        </div>
                    </div>
                ))}
            </div>
        </Modal>
    );
}
