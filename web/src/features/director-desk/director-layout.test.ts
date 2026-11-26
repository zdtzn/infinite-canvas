import { expect, test } from "bun:test";
import { createInitialDirectorState, useDirectorStore } from "./studio/editor/store/directorStore";
import { getSceneSummary } from "./studio/editor/schema/cameraLayouts";
import { createOrbitLayout } from "./api/orbit";

test("orbit cameras append as one undoable scene change and preserve original cameras", () => {
    useDirectorStore.setState({ ...createInitialDirectorState(), undoStack: [], undoBatchDepth: 0, undoBatchSnapshot: null, undoBatchHasTrackedChanges: false });
    const before = useDirectorStore.getState();
    const scene = getSceneSummary(before.project, before.selectedObjectIds, "scene-one");
    const layout = createOrbitLayout(scene, "char_default_a", 8, -2, 4);
    before.applyCameraLayout(layout);
    const after = useDirectorStore.getState();
    expect(after.project.cameras).toHaveLength(before.project.cameras.length + 4);
    expect(after.project.cameras[0]).toEqual(before.project.cameras[0]);
    expect(after.undoStack).toHaveLength(1);
    after.undo();
    expect(useDirectorStore.getState().project).toEqual(before.project);
});

test("invalid targets and orbit parameters cannot alter the scene", () => {
    const before = useDirectorStore.getState();
    const scene = getSceneSummary(before.project, before.selectedObjectIds, "scene-one");
    for (const [distance, height, count] of [[0, 0, 4], [8, NaN, 4], [8, 0, 0], [8, 0, 25], [8, 0, 1.5]]) expect(() => createOrbitLayout(scene, "char_default_a", distance, height, count)).toThrow();
    expect(() => createOrbitLayout(scene, "missing", 8, 2, 4)).toThrow("CAMERA_TARGET_MISSING");
    expect(useDirectorStore.getState()).toBe(before);
});
