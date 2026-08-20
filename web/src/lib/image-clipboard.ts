export function getClipboardImageFiles(data: DataTransfer | null | undefined): File[] {
    if (!data) return [];
    const itemFiles = Array.from(data.items || [])
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
    if (itemFiles.length) return itemFiles;
    return Array.from(data.files || []).filter((file) => file.type.startsWith("image/"));
}
