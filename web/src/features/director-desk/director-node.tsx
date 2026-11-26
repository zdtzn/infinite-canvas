import { lazy, Suspense, useState } from "react";
import { Clapperboard } from "lucide-react";
import { Button, Modal, Spin } from "antd";
import type { CanvasNodeContext, CanvasNodeDefinition } from "@/types/canvas-plugin";

const DirectorEditor = lazy(() => import("./director-editor"));

function DirectorNode({ ctx }: { ctx: CanvasNodeContext }) {
    const [open, setOpen] = useState(false);
    return <div className="flex h-full flex-col items-center justify-center gap-4 p-5" style={{ color: ctx.theme.node.text }}>
        <Clapperboard className="size-8 opacity-60" />
        <div className="text-center"><p className="font-medium">3D 导演台</p><p className="mt-2 text-xs opacity-60">摆位、机位、轨迹与分镜录制</p></div>
        <Button type="text" onPointerDown={event => event.stopPropagation()} onClick={() => setOpen(true)}>打开导演台</Button>
        <Modal open={open} footer={null} closable={false} keyboard={false} mask={{ closable: false }} width="100vw" style={{ top: 0, margin: 0, paddingBottom: 0, maxWidth: "100vw" }} styles={{ body: { height: "100dvh", padding: 0 }, container: { padding: 0, borderRadius: 0 } }} destroyOnHidden>
            <Suspense fallback={<div className="grid h-full place-items-center"><Spin description="正在打开导演台" /></div>}>
                {open && <DirectorEditor ctx={ctx} onClose={() => setOpen(false)} />}
            </Suspense>
        </Modal>
    </div>;
}

export const directorNodeDefinition: CanvasNodeDefinition = {
    type: "director:studio", title: "3D 导演台", icon: <Clapperboard className="size-5" />,
    description: "三维摆位、镜头与分镜", defaultSize: { width: 340, height: 220 },
    hidePanel: true, Content: DirectorNode,
};
