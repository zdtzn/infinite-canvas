export const BUILT_IN_PROMPT_SOURCES = [
    { id: "banana-prompt-quicker", name: "Banana Prompt Quicker", githubUrl: "https://glidea.github.io/banana-prompt-quicker/" },
    { id: "davidwu-gpt-image2-prompts", name: "davidwu-gpt-image2-prompts", githubUrl: "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts" },
    { id: "freestylefly-awesome-gpt-image-2", name: "freestylefly/awesome-gpt-image-2", githubUrl: "https://github.com/freestylefly/awesome-gpt-image-2" },
    { id: "awesome-gpt-image", name: "awesome-gpt-image", githubUrl: "https://github.com/ZeroLu/awesome-gpt-image" },
    { id: "awesome-gpt4o-image-prompts", name: "awesome-gpt4o-image-prompts", githubUrl: "https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts" },
    { id: "evolink-gpt-image-2-commercial", name: "GPT Image 2 商业创意精选", githubUrl: "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts" },
    { id: "jamez-bondos-awesome-gpt4o-images", name: "GPT-4o 图像案例精选", githubUrl: "https://github.com/jamez-bondos/awesome-gpt4o-images" },
    { id: "youmind-gpt-image-2", name: "youmind-gpt-image-2", githubUrl: "https://github.com/YouMind-OpenLab/awesome-gpt-image-2" },
    { id: "youmind-nano-banana-pro", name: "youmind-nano-banana-pro", githubUrl: "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts" },
] as const;

export type BuiltInPromptSourceId = (typeof BUILT_IN_PROMPT_SOURCES)[number]["id"];
