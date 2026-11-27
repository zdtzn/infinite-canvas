import type { DirectorProject } from "../studio/editor/schema/directorProject";

export type Scene = { project: DirectorProject; keys: string[] };
export type Attachment = { key: string; file: Blob };
export type DeskAction =
    | { action: "load" }
    | { action: "save"; scene: Scene; added: Attachment[] }
    | { action: "background" }
    | { action: "captures"; items: { file: Blob; name: string }[] }
    | { action: "recording"; file: Blob; name: string }
    | { action: "close" };
