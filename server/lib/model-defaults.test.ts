import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAppDatabase } from "../db/database";
import type { ServerState } from "../types";
import { IMAGE_MODEL_DEFAULT_SETTING_KEY, loadPlatformImageDefault, normalizePlatformImageDefaultTarget, savePlatformImageDefault } from "./model-defaults";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
    }
  }
});

function database() {
  const dataDir = mkdtempSync(join(tmpdir(), "canvas-model-defaults-"));
  directories.push(dataDir);
  return { dataDir, store: openAppDatabase({ dataDir }) };
}

function fixtureState(): ServerState {
  const state = { version: 1, auth: { adminUserId: "admin", accessCodeHash: "fixture", sessionSecret: "fixture" }, users: {}, channels: {}, assets: {}, jobs: {}, projects: {}, projectTombstones: {} } as ServerState;
  state.channels["admin:shared"] = {
    id: "shared", userId: "admin", name: "Shared", baseUrl: "https://fixture.example", apiFormat: "openai", apiKey: { iv: "fixture", tag: "fixture", data: "fixture" }, updatedAt: 1,
    models: [{ name: "image-a", capability: "image" }, { name: "image-b", capability: "image" }, { name: "text-a", capability: "text" }],
  };
  return state;
}

test("shared image defaults persist across database reopen and only changed selections advance their revision", () => {
  const { dataDir, store } = database();
  const state = fixtureState();
  try {
    expect(loadPlatformImageDefault(store, state)).toBeNull();
    expect(savePlatformImageDefault(store, { channelId: "shared", model: "image-a" })).toEqual({ channelId: "shared", model: "image-a", revision: 1 });
    expect(savePlatformImageDefault(store, { channelId: "shared", model: "image-a" }).revision).toBe(1);
    expect(savePlatformImageDefault(store, { channelId: "shared", model: "image-b" }).revision).toBe(2);
  } finally {
    store.close();
  }
  const reopened = openAppDatabase({ dataDir });
  try {
    expect(loadPlatformImageDefault(reopened, state)).toEqual({ channelId: "shared", model: "image-b", revision: 2 });
    expect(reopened.loadState().users).toEqual({});
  } finally {
    reopened.close();
  }
});

test("removed or reclassified default models become unavailable without deleting the stored revision", () => {
  const { store } = database();
  try {
    const state = fixtureState();
    savePlatformImageDefault(store, { channelId: "shared", model: "image-a" });
    state.channels["admin:shared"].models![0].capability = "text";
    expect(loadPlatformImageDefault(store, state)).toBeNull();
    expect(store.loadSetting(IMAGE_MODEL_DEFAULT_SETTING_KEY)).toMatchObject({ model: "image-a", revision: 1 });
    state.channels["admin:shared"].models = [];
    state.jobs.old = { id: "old", createdAt: 1, status: "succeeded", input: { userId: "member", channelId: "shared", apiFormat: "openai", model: "image-a", prompt: "fixture", count: 1, references: [] } };
    expect(loadPlatformImageDefault(store, state)).toBeNull();
    expect(savePlatformImageDefault(store, { channelId: "shared", model: "image-b" }).revision).toBe(2);
    delete state.channels["admin:shared"];
    expect(loadPlatformImageDefault(store, state)).toBeNull();
    expect(savePlatformImageDefault(store, { channelId: "restored", model: "image-b" }).revision).toBe(3);
  } finally {
    store.close();
  }
});

test("stored defaults never resolve to user-owned channels or non-image models", () => {
  const { store } = database();
  try {
    const state = fixtureState();
    state.channels["member:private"] = { ...state.channels["admin:shared"], id: "private", userId: "member" };
    for (const target of [{ channelId: "private", model: "image-a" }, { channelId: "shared", model: "text-a" }]) {
      savePlatformImageDefault(store, target);
      expect(loadPlatformImageDefault(store, state)).toBeNull();
    }
  } finally {
    store.close();
  }
});

test("default target validation rejects coercion, invalid identifiers and unbounded models", () => {
  expect(normalizePlatformImageDefaultTarget({ channelId: " shared ", model: " image-a " })).toEqual({ channelId: "shared", model: "image-a" });
  for (const value of [null, [], "shared", { channelId: {}, model: "image-a" }, { channelId: "shared", model: 12 }, { channelId: "__proto__", model: "image-a" }, { channelId: "x".repeat(129), model: "image-a" }, { channelId: "shared", model: "" }, { channelId: "shared", model: "x".repeat(201) }, { channelId: "shared", model: "image\u0000a" }]) {
    expect(() => normalizePlatformImageDefaultTarget(value)).toThrow();
  }
});

test("malformed stored defaults stay unavailable and revision exhaustion cannot overwrite a valid selection", () => {
  const { store } = database();
  try {
    const state = fixtureState();
    for (const revision of [0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
      store.saveSetting(IMAGE_MODEL_DEFAULT_SETTING_KEY, { channelId: "shared", model: "image-a", revision });
      expect(loadPlatformImageDefault(store, state)).toBeNull();
    }
    const last = { channelId: "shared", model: "image-a", revision: Number.MAX_SAFE_INTEGER };
    store.saveSetting(IMAGE_MODEL_DEFAULT_SETTING_KEY, last);
    expect(savePlatformImageDefault(store, last)).toEqual(last);
    expect(() => savePlatformImageDefault(store, { channelId: "shared", model: "image-b" })).toThrow(RangeError);
    expect(store.loadSetting(IMAGE_MODEL_DEFAULT_SETTING_KEY)).toEqual(last);
  } finally {
    store.close();
  }
});
