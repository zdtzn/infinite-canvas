import { layoutResultSchema, sceneSummarySchema, type SceneSummary } from "./camera-layouts";

export function createOrbitLayout(input: SceneSummary, targetId: string, distance: number, height: number, count: number) {
    const scene = sceneSummarySchema.parse(input);
    if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(height) || !Number.isInteger(count) || count < 1 || count > 24) throw new Error("镜头参数无效");
    const object = scene.objects.find(item => item.id === targetId && item.visible);
    if (!object?.focusTarget) throw new Error("CAMERA_TARGET_MISSING");
    const target = object.focusTarget;
    return layoutResultSchema.parse({ sceneId: scene.sceneId, shots: Array.from({ length: count }, (_, index) => {
        const angle = index * Math.PI * 2 / count;
        return { name: `${object.name} · 环绕 ${index + 1}`, position: [target[0] + Math.sin(angle) * distance, target[1] + height, target[2] + Math.cos(angle) * distance], target, fov: 50, targetObjectId: object.id };
    }) });
}
