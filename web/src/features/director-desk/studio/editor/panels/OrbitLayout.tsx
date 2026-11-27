import { useRef, useState } from "react";
import { Orbit } from "lucide-react";
import { createOrbitLayout } from "../../../api/orbit";
import { notify } from "../io/session";
import { getSceneSummary } from "../schema/cameraLayouts";
import { useDirectorStore } from "../store/directorStore";

export function OrbitLayout() {
    const dialog = useRef<HTMLDialogElement>(null);
    const form = useRef<HTMLFormElement>(null);
    const [targets, setTargets] = useState<{ id: string; name: string }[]>([]);
    const open = () => {
        const state = useDirectorStore.getState();
        const scene = getSceneSummary(state.project, state.selectedObjectIds, "studio");
        setTargets(scene.objects.filter(item => item.visible && item.focusTarget));
        dialog.current?.showModal();
    };
    const add = () => {
        if (!form.current?.reportValidity()) return;
        const values = new FormData(form.current);
        const state = useDirectorStore.getState();
        try {
            const scene = getSceneSummary(state.project, state.selectedObjectIds, "studio");
            const count = Number(values.get("count"));
            state.applyCameraLayout(createOrbitLayout(scene, String(values.get("target")), Number(values.get("distance")), Number(values.get("height")), count));
            dialog.current?.close();
            notify(`已添加 ${count} 个环绕机位`);
        } catch { notify("镜头布局未完成，请确认目标仍在场景中后重试"); }
    };
    return <>
        <button className="top-bar-action-button" type="button" aria-label="环绕镜头布局" title="环绕镜头布局" onClick={open}><Orbit size={16} /></button>
        <dialog ref={dialog} className="orbit-layout ui-panel" aria-labelledby="director-orbit-title" onKeyDown={event => event.stopPropagation()}>
            <h2 id="director-orbit-title">环绕目标添加镜头</h2>
            <form ref={form} onSubmit={event => { event.preventDefault(); add(); }}>
                <label>镜头目标<select name="target" className="ui-field" required>
                    {targets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select></label>
                <label>距离<input name="distance" className="ui-field" type="number" min={0.1} max={1000} step="any" defaultValue={8} required /></label>
                <label>相对高度<input name="height" className="ui-field" type="number" min={-1000} max={1000} step="any" defaultValue={2} required /></label>
                <label>镜头数量<input name="count" className="ui-field" type="number" min={1} max={24} defaultValue={4} required /></label>
                <div className="orbit-layout-actions">
                    <button type="button" className="top-bar-action-button" onClick={() => dialog.current?.close()}>取消</button>
                    <button type="button" className="top-bar-action-button" disabled={!targets.length} onClick={add}>添加镜头</button>
                </div>
            </form>
        </dialog>
    </>;
}
