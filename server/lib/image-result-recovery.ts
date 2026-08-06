import type { ImageJobImage } from "../types";

type DeferredImageInput = {
  id: string;
  url: string;
  durationMs: number;
  width?: number;
  height?: number;
  expiresAt?: string;
};

export function createDeferredImageResult(
  input: DeferredImageInput,
): ImageJobImage {
  return {
    id: input.id,
    dataUrl: input.url,
    bytes: 0,
    durationMs: input.durationMs,
    mimeType: imageMimeType(input.url),
    ...(positiveDimension(input.width) ? { width: input.width } : {}),
    ...(positiveDimension(input.height) ? { height: input.height } : {}),
    persisted: false,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  };
}

function positiveDimension(value?: number) {
  return Number.isSafeInteger(value) && (value || 0) > 0;
}

export function hasDeferredImageResults(images: ImageJobImage[]) {
  return images.some(
    (image) => image.persisted === false && /^https:\/\//i.test(image.dataUrl),
  );
}

export function isCompletedUuResultRecovery(input: {
  upstream?: { provider?: string; taskId?: string; status?: string };
}) {
  return (
    input.upstream?.provider === "uu-image" &&
    Boolean(input.upstream.taskId) &&
    input.upstream.status === "succeeded"
  );
}

export function isRecoverableImageDownloadError(error: unknown) {
  const status =
    error && typeof error === "object" && "status" in error
      ? Number(error.status)
      : 0;
  if ([502, 503, 504, 524].includes(status)) return true;
  const message = error instanceof Error ? error.message : String(error || "");
  return /无法连接上游接口|上游接口响应超时|下载生成图片失败[：:]\s*(?:502|503|504|524)|timed?\s*out|timeout|connection (?:reset|refused)|fetch failed/i.test(
    message,
  );
}

export async function recoverDeferredImageResults(
  images: ImageJobImage[],
  recover: (image: ImageJobImage) => Promise<ImageJobImage>,
) {
  let recovered = 0;
  const next: ImageJobImage[] = [];
  for (const image of images) {
    if (image.persisted !== false || !/^https:\/\//i.test(image.dataUrl)) {
      next.push(image);
      continue;
    }
    try {
      const persisted = await recover(image);
      next.push({
        ...persisted,
        id: image.id,
        persisted: true,
        expiresAt: undefined,
      });
      recovered += 1;
    } catch {
      next.push(image);
    }
  }
  return {
    images: next,
    recovered,
    remaining: next.filter((image) => image.persisted === false).length,
  };
}

function imageMimeType(value: string) {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg"))
      return "image/jpeg";
    if (pathname.endsWith(".webp")) return "image/webp";
    if (pathname.endsWith(".avif")) return "image/avif";
  } catch {
    // Provider URLs are validated before a deferred result is created.
  }
  return "image/png";
}
