export type AssetFolder = { id: string; name: string; parentId: string | null };
export type AssetFolderSnapshot = { revision: number; folders: AssetFolder[] };
export const ASSET_FOLDERS_KEY = "asset-folders";

export function normalizeAssetFolders(input: unknown): AssetFolder[] {
    if (!Array.isArray(input) || input.length > 300) throw new Error("文件夹格式无效，最多可创建 300 个文件夹");
    const ids = new Set<string>();
    const siblings = new Set<string>();
    const folders = input.map(value => {
        if (!value || typeof value !== "object") throw new Error("文件夹格式无效");
        const { id, name, parentId } = value;
        if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id) || ids.has(id)) throw new Error("文件夹标识无效或重复");
        if (typeof name !== "string" || !name.trim() || name.trim().length > 80 || /[\p{C}/\\]/u.test(name)) throw new Error("文件夹名称须为 1–80 字且不包含斜杠或控制字符");
        if (parentId !== null && typeof parentId !== "string") throw new Error("上级文件夹无效");
        const sibling = `${parentId}\0${name.trim()}`;
        if (siblings.has(sibling)) throw new Error("同一目录下不能有重名文件夹");
        ids.add(id); siblings.add(sibling);
        return { id, name: name.trim(), parentId } as AssetFolder;
    });
    const byId = new Map(folders.map(folder => [folder.id, folder]));
    for (const folder of folders) {
        const visited = new Set([folder.id]);
        let parent = folder.parentId;
        while (parent !== null) {
            if (!byId.has(parent) || visited.has(parent) || visited.size >= 12) throw new Error("文件夹不能形成循环，且最多支持 12 层");
            visited.add(parent); parent = byId.get(parent)!.parentId;
        }
    }
    return folders;
}

export function assetFolderOptions(folders: AssetFolder[]) {
    const byId = new Map(folders.map(folder => [folder.id, folder]));
    return folders.map(folder => {
        const parts = [folder.name];
        let parent = folder.parentId;
        const visited = new Set([folder.id]);
        while (parent && !visited.has(parent) && byId.has(parent)) {
            visited.add(parent); const item = byId.get(parent)!; parts.unshift(item.name); parent = item.parentId;
        }
        return { value: folder.id, label: parts.join(" / ") };
    }).sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
}

export function removedFolderDestination(id: string, previous: AssetFolder[], next: AssetFolder[]) {
    const kept = new Set(next.map(folder => folder.id));
    const parents = new Map(previous.map(folder => [folder.id, folder.parentId]));
    let target: string | null = id;
    while (target && !kept.has(target)) target = parents.get(target) || null;
    return target;
}

export function mergeAssetFolders(existing: AssetFolder[], incoming: AssetFolder[]) {
    const source = normalizeAssetFolders(incoming);
    const folders = [...existing];
    const mapping = new Map<string, string>();
    const add = (folder: AssetFolder): string => {
        if (mapping.has(folder.id)) return mapping.get(folder.id)!;
        const parentId = folder.parentId ? add(source.find(item => item.id === folder.parentId)!) : null;
        const same = folders.find(item => item.parentId === parentId && item.name === folder.name);
        const id = same?.id || (folders.some(item => item.id === folder.id) ? crypto.randomUUID() : folder.id);
        if (!same) folders.push({ ...folder, id, parentId });
        mapping.set(folder.id, id);
        return id;
    };
    source.forEach(add);
    return { folders: normalizeAssetFolders(folders), mapping };
}
