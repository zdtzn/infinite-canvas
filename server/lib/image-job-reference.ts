const IMAGE_ASSET_KEY_PATTERN = /^image:[A-Za-z0-9._:-]{1,180}$/;

export class ImageJobReferenceInputError extends Error {}

export type ParsedClientImageJobReference =
  | { kind: "data"; dataUrl: string }
  | { kind: "asset"; assetKey: string };

export function parseClientImageJobReference(
  value: unknown,
): ParsedClientImageJobReference {
  if (typeof value === "string") return { kind: "data", dataUrl: value };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const assetKey = String(
      (value as Record<string, unknown>).assetKey || "",
    ).trim();
    if (IMAGE_ASSET_KEY_PATTERN.test(assetKey)) {
      return { kind: "asset", assetKey };
    }
  }
  throw new ImageJobReferenceInputError("参考图引用格式无效");
}
