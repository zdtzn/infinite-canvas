import { expect, test } from "bun:test";
import { geminiImageGenerationConfig, imageEditReferenceField } from "./image-provider-protocol";

test("server multipart preserves single-file compatibility and multi-reference arrays", () => {
    const form = new FormData();
    ["a", "b"].forEach((name) => form.append(imageEditReferenceField(2), new Blob([name]), `${name}.png`));
    expect(form.getAll("image[]")).toHaveLength(2);
    expect(imageEditReferenceField(1)).toBe("image");
});
test("server Gemini parameters use imageConfig rather than responseFormat", () => {
    expect(geminiImageGenerationConfig({ aspectRatio: "16:9", imageSize: "2K" })).toEqual({ responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "2K" } });
    expect(geminiImageGenerationConfig({})).not.toHaveProperty("imageConfig");
});
