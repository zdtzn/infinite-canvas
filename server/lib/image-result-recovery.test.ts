import { describe, expect, test } from "bun:test";

import {
  createDeferredImageResult,
  hasDeferredImageResults,
  isCompletedUuResultRecovery,
  isRecoverableImageDownloadError,
  recoverDeferredImageResults,
} from "./image-result-recovery";

describe("deferred upstream image recovery", () => {
  test("keeps a completed UU result visible while server persistence is pending", () => {
    const image = createDeferredImageResult({
      id: "image-a",
      url: "https://img.uuapi.net/result.png",
      durationMs: 42_000,
      width: 1024,
      height: 1024,
      expiresAt: "2026-08-13T00:00:00.000Z",
    });

    expect(image).toEqual({
      id: "image-a",
      dataUrl: "https://img.uuapi.net/result.png",
      bytes: 0,
      durationMs: 42_000,
      mimeType: "image/png",
      width: 1024,
      height: 1024,
      persisted: false,
      expiresAt: "2026-08-13T00:00:00.000Z",
    });
    expect(hasDeferredImageResults([image])).toBe(true);
  });

  test("treats only connection and timeout failures as recoverable", () => {
    expect(isRecoverableImageDownloadError({ status: 502 })).toBe(true);
    expect(isRecoverableImageDownloadError({ status: 503 })).toBe(true);
    expect(isRecoverableImageDownloadError({ status: 504 })).toBe(true);
    expect(
      isRecoverableImageDownloadError(new Error("下载生成图片失败：524")),
    ).toBe(true);
    expect(
      isRecoverableImageDownloadError(
        new Error("无法连接上游接口，请检查渠道地址、网络或接口状态"),
      ),
    ).toBe(true);
    expect(
      isRecoverableImageDownloadError(
        new Error("上游返回的图片格式或大小不受支持"),
      ),
    ).toBe(false);
    expect(
      isRecoverableImageDownloadError(new Error("下载生成图片失败：400")),
    ).toBe(false);
  });

  test("recognizes a retry that only resumes an already completed UU task", () => {
    expect(
      isCompletedUuResultRecovery({
        upstream: {
          provider: "uu-image",
          taskId: "uug_done",
          status: "succeeded",
        },
      }),
    ).toBe(true);
    expect(
      isCompletedUuResultRecovery({
        upstream: {
          provider: "uu-image",
          taskId: "uug_running",
          status: "running",
        },
      }),
    ).toBe(false);
    expect(
      isCompletedUuResultRecovery({
        upstream: { provider: "other", taskId: "done", status: "succeeded" },
      }),
    ).toBe(false);
  });

  test("replaces recovered files without changing their client-visible ids", async () => {
    const deferred = createDeferredImageResult({
      id: "image-a",
      url: "https://img.uuapi.net/result.png",
      durationMs: 42_000,
      width: 1024,
      height: 1024,
    });

    const result = await recoverDeferredImageResults(
      [deferred],
      async (image) => ({
        id: "new-server-id",
        dataUrl: "/api/job-files/job-a/result.png",
        bytes: 1234,
        durationMs: image.durationMs,
        mimeType: "image/png",
        width: 1024,
        height: 1024,
      }),
    );

    expect(result.remaining).toBe(0);
    expect(result.recovered).toBe(1);
    expect(result.images[0]).toMatchObject({
      id: "image-a",
      dataUrl: "/api/job-files/job-a/result.png",
      bytes: 1234,
      persisted: true,
    });
  });

  test("keeps a temporary result available when a recovery attempt still fails", async () => {
    const deferred = createDeferredImageResult({
      id: "image-a",
      url: "https://img.uuapi.net/result.png",
      durationMs: 42_000,
      width: 1024,
      height: 1024,
    });

    const result = await recoverDeferredImageResults([deferred], async () => {
      throw new Error("still unavailable");
    });

    expect(result.recovered).toBe(0);
    expect(result.remaining).toBe(1);
    expect(result.images[0]).toEqual(deferred);
  });
});
