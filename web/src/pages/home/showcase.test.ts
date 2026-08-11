import { expect, test } from "bun:test";

import type { Prompt } from "@/services/api/prompts";

import { selectHomepagePromptShowcase, selectHomepagePromptWindow } from "./showcase";

test("selects the curated freestylefly homepage prompts in the intended order", () => {
    const prompts = [prompt("other", "例 1：其他案例"), prompt("ink", "例 359：水墨双重曝光人物海报"), prompt("toy", "例 378：高端 3D 收藏玩具头像"), prompt("phone", "例 361：手机爆炸拆解图")];

    expect(selectHomepagePromptShowcase(prompts, 3).map((item) => item.id)).toEqual(["toy", "phone", "ink"]);
});

test("fills missing curated entries without showing prompts that lack images", () => {
    const prompts = [prompt("other-1", "其他案例一"), prompt("empty", "无图案例", ""), prompt("other-2", "其他案例二")];

    expect(selectHomepagePromptShowcase(prompts, 2).map((item) => item.id)).toEqual(["other-1", "other-2"]);
});

test("keeps every available prompt in the homepage rotation and interleaves sources", () => {
    const prompts = [prompt("a-1", "A1", undefined, "source-a"), prompt("a-2", "A2", undefined, "source-a"), prompt("b-1", "B1", undefined, "source-b"), prompt("b-2", "B2", undefined, "source-b")];

    expect(selectHomepagePromptShowcase(prompts).map((item) => item.id)).toEqual(["a-1", "b-1", "a-2", "b-2"]);
});

test("selects a bounded rotating window and wraps at the end of the playlist", () => {
    const prompts = [prompt("one", "One"), prompt("two", "Two"), prompt("three", "Three"), prompt("four", "Four")];

    expect(selectHomepagePromptWindow(prompts, 3, 3).map((item) => item.id)).toEqual(["four", "one", "two"]);
});

function prompt(id: string, title: string, coverUrl = `https://example.com/${id}.jpg`, category = "freestylefly/awesome-gpt-image-2"): Prompt {
    return {
        id,
        title,
        prompt: `${title} prompt`,
        coverUrl,
        tags: ["gpt-image-2", "freestylefly"],
        preview: "",
        createdAt: "",
        updatedAt: "",
        category,
        githubUrl: "https://github.com/freestylefly/awesome-gpt-image-2",
    };
}
