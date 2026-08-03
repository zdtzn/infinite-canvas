import { describe, expect, test } from "bun:test";

import {
  listPlatformChannels,
  normalizeChannelModels,
  platformChannelKey,
  platformChannelModels,
  platformChannelPublicRecord,
  platformPromptOptimizationTarget,
  resolvePlatformChannel,
  setPlatformPromptOptimizationTarget,
} from "./platform-channels";
import type { ServerState } from "../types";

describe("platform channels", () => {
  test("shares only administrator-owned channels and never user-owned channels", () => {
    const state = createState();

    expect(listPlatformChannels(state).map((channel) => channel.id)).toEqual(["shared"]);
    expect(resolvePlatformChannel(state, "shared")?.userId).toBe("admin");
    expect(resolvePlatformChannel(state, "private")).toBeUndefined();
    expect(platformChannelKey("admin", "shared")).toBe("admin:shared");
    const publicSource = listPlatformChannels(state)[0];
    publicSource.promptOptimizationModel = "hidden-text-model";
    expect(platformChannelPublicRecord(publicSource)).not.toHaveProperty("promptOptimizationModel");
    expect(platformChannelPublicRecord(publicSource)).not.toHaveProperty("apiKey");
  });

  test("recovers missing model metadata from recent platform jobs", () => {
    const state = createState();
    state.channels["admin:shared"].models = [];
    state.jobs.job = {
      id: "job",
      status: "succeeded",
      createdAt: 1,
      input: {
        userId: "member",
        channelId: "shared",
        apiFormat: "openai",
        model: "gpt-image-2",
        prompt: "test",
        count: 1,
        references: [],
      },
    };

    expect(listPlatformChannels(state)[0].models).toEqual([{ name: "gpt-image-2", capability: "image" }]);
    expect(platformChannelModels(state, "shared")).toEqual([{ name: "gpt-image-2", capability: "image" }]);
  });

  test("uses the administrator's saved channel order before channel names", () => {
    const state = createState();
    state.channels["admin:shared"].sortOrder = 2;
    state.channels["admin:alpha"] = {
      ...state.channels["admin:shared"],
      id: "alpha",
      name: "Alpha",
      sortOrder: 1,
    };
    state.channels["admin:beta"] = {
      ...state.channels["admin:shared"],
      id: "beta",
      name: "Beta",
      sortOrder: 0,
    };

    expect(listPlatformChannels(state).map((channel) => channel.id)).toEqual(["beta", "alpha", "shared"]);
  });

  test("normalizes model capabilities and removes duplicates", () => {
    expect(
      normalizeChannelModels([
        { name: "gpt-image-2", capability: "invalid" },
        { name: "gpt-image-2", capability: "text" },
        { name: "voice-pro", capability: "audio" },
      ]),
    ).toEqual([
      { name: "gpt-image-2", capability: "image" },
      { name: "voice-pro", capability: "audio" },
    ]);
  });

  test("stores one administrator prompt optimizer target without changing the database schema", () => {
    const state = createState();
    state.channels["admin:shared"].models = [
      { name: "gpt-image-2", capability: "image" },
      { name: "text-primary", capability: "text" },
    ];
    state.channels["admin:secondary"] = {
      ...state.channels["admin:shared"],
      id: "secondary",
      name: "Secondary",
      models: [{ name: "text-secondary", capability: "text" }],
    };

    expect(setPlatformPromptOptimizationTarget(state, { channelId: "shared", model: "text-primary" }, 10)).toBeTrue();
    expect(platformPromptOptimizationTarget(state)).toEqual({ channelId: "shared", model: "text-primary" });
    expect(state.channels["admin:shared"].updatedAt).toBe(10);

    expect(setPlatformPromptOptimizationTarget(state, { channelId: "secondary", model: "text-secondary" }, 20)).toBeTrue();
    expect(platformPromptOptimizationTarget(state)).toEqual({ channelId: "secondary", model: "text-secondary" });
    expect(state.channels["admin:shared"].promptOptimizationModel).toBeUndefined();
    expect(setPlatformPromptOptimizationTarget(state, { channelId: "shared", model: "gpt-image-2" })).toBeFalse();

    expect(setPlatformPromptOptimizationTarget(state, null, 30)).toBeTrue();
    expect(platformPromptOptimizationTarget(state)).toBeNull();
  });
});

function createState(): ServerState {
  return {
    version: 1,
    auth: { accessCodeHash: "hash", sessionSecret: "secret", adminUserId: "admin" },
    users: {
      admin: { userId: "admin", displayName: "Admin", admin: true, createdAt: 1 },
      member: { userId: "member", displayName: "Member", createdAt: 2 },
    },
    channels: {
      "admin:shared": {
        id: "shared",
        userId: "admin",
        name: "Shared",
        baseUrl: "https://example.com",
        apiFormat: "openai",
        apiKey: { iv: "iv", tag: "tag", data: "data" },
        models: [{ name: "gpt-image-2", capability: "image" }],
        updatedAt: 1,
      },
      "member:private": {
        id: "private",
        userId: "member",
        name: "Private",
        baseUrl: "https://private.example.com",
        apiFormat: "openai",
        apiKey: { iv: "iv", tag: "tag", data: "data" },
        updatedAt: 1,
      },
    },
    assets: {},
    jobs: {},
    projects: {},
    projectTombstones: {},
  };
}
