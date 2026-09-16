import type { CanvasCameraSettings, CanvasGenerationMode } from "@/types/canvas";

export type { CanvasCameraSettings } from "@/types/canvas";

// These profiles guide model output; they do not configure physical capture hardware.
export const CAMERA_PROFILES = [
    { id: "panavision_dxl2", label: "潘那维申 DXL2", prompt: "Panavision DXL2 look, large-format cinematic texture and gentle highlights" },
    { id: "arri_alexa_mini_lf", label: "阿莱 Alexa Mini LF", prompt: "ARRI Alexa Mini LF look, natural skin tones and smooth highlight transitions" },
    { id: "red_komodo_6k", label: "RED 科莫多 6K", prompt: "RED Komodo 6K look, crisp modern detail and clean shadows" },
    { id: "red_v_raptor_8k", label: "RED V-Raptor 8K", prompt: "RED V-Raptor 8K look, detailed large-format imagery and vivid natural color" },
    { id: "sony_venice_2", label: "索尼 Venice 2", prompt: "Sony Venice 2 look, refined cinema color and clean low-light tones" },
    { id: "sony_fx6", label: "索尼 FX6", prompt: "Sony FX6 look, natural documentary imagery" },
    { id: "blackmagic_ursa_12k", label: "黑魔法 URSA 12K", prompt: "Blackmagic URSA 12K look, rich filmic color" },
    { id: "canon_c500_mk2", label: "佳能 C500 Mark II", prompt: "Canon C500 Mark II look, warm natural skin tones" },
] as const;

export const LENS_PROFILES = [
    { id: "arri_signature_prime", label: "阿莱 Signature 定焦", prompt: "ARRI Signature Prime lens character, creamy bokeh and gentle contrast" },
    { id: "cooke_s7i", label: "库克 S7/i", prompt: "Cooke S7/i lens character, warm tones and soft rounded bokeh" },
    { id: "zeiss_supreme_prime", label: "蔡司 Supreme 定焦", prompt: "Zeiss Supreme Prime lens character, neutral color and refined sharpness" },
    { id: "canon_sumire_prime", label: "佳能 Sumire 定焦", prompt: "Canon Sumire Prime lens character, soft portraits and dreamy bokeh" },
    { id: "anamorphic_cooke", label: "库克变形宽银幕", prompt: "Cooke anamorphic lens character, oval bokeh and horizontal flares" },
    { id: "anamorphic_atlas", label: "Atlas Orion 变形宽银幕", prompt: "Atlas Orion anamorphic lens character, cyan horizontal flares and soft edges" },
    { id: "vintage_leica_r", label: "徕卡 R 复古镜头", prompt: "vintage Leica R lens character, glowing highlights and nostalgic color" },
    { id: "macro_100mm", label: "100mm 微距镜头", prompt: "macro lens character, fine close-up detail and a narrow focus plane" },
] as const;

export const FOCAL_LENGTHS = [14, 18, 24, 35, 40, 50, 65, 85, 100, 135, 200] as const;
export const APERTURES = [1.2, 1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11, 16] as const;
export const DEFAULT_CAMERA_SETTINGS: Readonly<CanvasCameraSettings> = Object.freeze({ enabled: false });
export const CAMERA_PROMPT_START = "[canvas-camera]";
export const CAMERA_PROMPT_END = "[/canvas-camera]";

/** Filter persisted/imported settings against the options supported by the dialog. */
export function normalizeCameraSettings(value: unknown): CanvasCameraSettings {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_CAMERA_SETTINGS };
    const input = value as Record<string, unknown>;
    return {
        enabled: input.enabled === true,
        ...(CAMERA_PROFILES.some((profile) => profile.id === input.cameraId) ? { cameraId: input.cameraId as string } : {}),
        ...(LENS_PROFILES.some((profile) => profile.id === input.lensId) ? { lensId: input.lensId as string } : {}),
        ...(FOCAL_LENGTHS.some((length) => length === input.focalLength) ? { focalLength: input.focalLength as number } : {}),
        ...(APERTURES.some((aperture) => aperture === input.aperture) ? { aperture: input.aperture as number } : {}),
    };
}

/** Compose at request time only. Never persist this result over the user's raw prompt.
 * Complete reserved camera blocks and their two-newline separator are replaceable;
 * all other text, including whitespace and angle/lighting instructions, is retained.
 */
export function applyCameraPrompt(prompt: string, settings: unknown, mode: CanvasGenerationMode): string {
    if (mode !== "image" && mode !== "video") return prompt;
    const raw = prompt.replace(/(?:\n\n)?\[canvas-camera\][\s\S]*?\[\/canvas-camera\]/g, "");
    const camera = normalizeCameraSettings(settings);
    if (!camera.enabled) return raw;
    const parts: (string | undefined)[] = [CAMERA_PROFILES.find((profile) => profile.id === camera.cameraId)?.prompt, LENS_PROFILES.find((profile) => profile.id === camera.lensId)?.prompt];
    if (camera.focalLength !== undefined) {
        const perspective = camera.focalLength <= 24 ? "wide-angle perspective" : camera.focalLength <= 50 ? "natural perspective" : "telephoto perspective with background compression";
        parts.push(`${camera.focalLength}mm, ${perspective}`);
    }
    if (camera.aperture !== undefined) parts.push(`f/${camera.aperture}, ${camera.aperture <= 2.8 ? "shallow depth of field and soft background bokeh" : camera.aperture < 8 ? "moderate depth of field" : "deep depth of field"}`);
    const guidance = parts.filter(Boolean).join("; ");
    if (!guidance) return raw;
    return `${raw}${raw ? "\n\n" : ""}${CAMERA_PROMPT_START}\n摄影参数仅用于画面风格引导：${guidance}. Apply the photographic look to the scene; do not add camera equipment to the frame.\n${CAMERA_PROMPT_END}`;
}
