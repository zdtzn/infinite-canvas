import { describe, expect, test } from "bun:test";

import { resolveServerImageCapabilityProfile, validateServerImageCapabilityRequest } from "./image-capabilities";

describe("server image channel capabilities", () => {
  test("uses conservative defaults for an unrecognized model explicitly set to auto", () => {
    const profile = resolveServerImageCapabilityProfile("vendor-new-image", "openai", "https://api.vendor.example", { mode: "auto" });

    expect(profile.source).toBe("conservative");
    expect(profile.capabilities.sizes).toEqual(["1:1"]);
    expect(profile.capabilities.resolutions).toEqual(["auto"]);
    expect(profile.capabilities.maxOutputs).toBe(1);
    expect(profile.capabilities.maxReferences).toBe(1);
  });

  test("keeps broad legacy behavior when old model metadata is absent", () => {
    const profile = resolveServerImageCapabilityProfile("vendor-existing-image", "openai", "https://api.vendor.example");

    expect(profile.source).toBe("legacy");
    expect(profile.capabilities.sizes).toContain("16:9");
    expect(profile.capabilities.customSize).toBeTrue();
    expect(profile.capabilities.maxOutputs).toBe(4);
  });

  test("auto mode still recognizes documented providers", () => {
    const profile = resolveServerImageCapabilityProfile("gpt-image-2", "openai", "https://uuapi.net/v1", { mode: "auto" });

    expect(profile.source).toBe("documented");
    expect(profile.capabilities.resolutions).toEqual(["low", "medium", "high"]);
    expect(profile.capabilities.customSize).toBeFalse();
    expect(profile.capabilities.maxOutputs).toBe(10);
  });

  test("uses the latest SADAI mapped-group ratios and reference limit", () => {
    const profile = resolveServerImageCapabilityProfile("gpt-image-2", "openai", "https://api.sadai.top/v1", { mode: "auto" });

    expect(profile.source).toBe("documented");
    expect(profile.capabilities.sizes).toEqual(["1:1", "5:4", "9:16", "21:9", "16:9", "3:2", "4:3", "4:5", "3:4", "2:3"]);
    expect(profile.capabilities.maxReferences).toBe(6);
  });

  test("validates custom ratio, format, output and reference limits", () => {
    const capabilities = resolveServerImageCapabilityProfile("vendor-image", "openai", "https://api.vendor.example", {
      mode: "custom",
      resolutions: ["low", "high"],
      generationQualities: ["auto", "high"],
      outputFormats: ["auto", "png"],
      sizes: ["1:1", "16:9"],
      maxOutputs: 2,
      maxReferences: 1,
    }).capabilities;

    expect(() =>
      validateServerImageCapabilityRequest(capabilities, {
        resolution: "high",
        imageQuality: "high",
        imageOutputFormat: "png",
        size: "16:9",
        referenceCount: 1,
        count: 2,
      }),
    ).not.toThrow();
    expect(() =>
      validateServerImageCapabilityRequest(capabilities, {
        resolution: "medium",
        size: "1:1",
        referenceCount: 0,
        count: 1,
      }),
    ).toThrow("输出分辨率");
    expect(() =>
      validateServerImageCapabilityRequest(capabilities, {
        resolution: "low",
        imageOutputFormat: "jpeg",
        size: "1:1",
        referenceCount: 0,
        count: 1,
      }),
    ).toThrow("输出格式");
    expect(() =>
      validateServerImageCapabilityRequest(capabilities, {
        resolution: "low",
        size: "4:3",
        referenceCount: 0,
        count: 1,
      }),
    ).toThrow("尺寸");
    expect(() =>
      validateServerImageCapabilityRequest(capabilities, {
        resolution: "low",
        size: "1:1",
        referenceCount: 2,
        count: 1,
      }),
    ).toThrow("参考图");
    expect(() =>
      validateServerImageCapabilityRequest(capabilities, {
        resolution: "low",
        size: "1:1",
        referenceCount: 0,
        count: 3,
      }),
    ).toThrow("最多生成");
  });
});
