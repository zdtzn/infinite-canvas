import { z } from "zod";

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const transform = z.object({ position: vector, rotation: vector, scale: vector }).strict();
const shot = z.object({ name: z.string(), position: vector, target: vector, fov: z.number().finite().min(10).max(120), targetObjectId: z.string().nullable() }).strict();

export const sceneSummarySchema = z.object({
    sceneId: z.string(), transform,
    objects: z.array(z.object({
        id: z.string(), name: z.string(), kind: z.enum(["character", "scene", "prop", "camera", "panorama"]),
        visible: z.boolean(), transform, focusTarget: vector.nullable(),
    }).strict()),
    cameras: z.array(shot.extend({ id: z.string() })), selectedObjectIds: z.array(z.string()),
}).strict();
export const layoutResultSchema = z.object({ sceneId: z.string(), shots: z.array(shot) }).strict();
export type SceneSummary = z.infer<typeof sceneSummarySchema>;
export type LayoutResult = z.infer<typeof layoutResultSchema>;
