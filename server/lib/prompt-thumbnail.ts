import { assertAllowedUpstreamUrl } from "./url-policy";

export function promptThumbnailOptions(params: URLSearchParams) {
    const source = assertAllowedUpstreamUrl(params.get("url") || "");
    if (source.username || source.password) throw new Error("图片地址不能包含凭证");
    const dimension = (value: string | null) => Math.max(1, Math.min(1280, Math.floor(Number(value) || 640)));
    return { source: source.toString(), width: dimension(params.get("w")), height: dimension(params.get("h")) };
}

/** Keep the original aspect ratio and do image work off the request thread. */
export async function createPromptThumbnail(bytes: Uint8Array, width: number, height: number) {
    return new Uint8Array(await new Bun.Image(bytes, { maxPixels: 16_000_000 })
        .resize(width, height, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 78 })
        .bytes());
}
