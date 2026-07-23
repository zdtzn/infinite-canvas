import { unzip, zipSync } from "fflate";

type ZipFile = {
    name: string;
    data: BlobPart;
};

const MAX_ZIP_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 1_000;
const MAX_ZIP_EXPANDED_BYTES = 128 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 32 * 1024 * 1024;

export async function createZip(files: ZipFile[]) {
    const entries = await Promise.all(
        files.map(async (file) => {
            const data = new Uint8Array(await new Blob([file.data]).arrayBuffer());
            return [file.name, data] as const;
        }),
    );
    return new Blob([zipSync(Object.fromEntries(entries), { level: 0 })], { type: "application/zip" });
}

export async function readZip(file: Blob) {
    if (file.size > MAX_ZIP_BYTES) throw new Error("压缩包不能超过 32 MB");
    const entries = await unzipAsync(new Uint8Array(await file.arrayBuffer()));
    const names = Object.keys(entries);
    if (names.length > MAX_ZIP_ENTRIES) throw new Error("压缩包文件数量过多");
    let total = 0;
    for (const [name, data] of Object.entries(entries)) {
        if (!isSafeZipPath(name)) throw new Error("压缩包包含不安全路径");
        if (data.byteLength > MAX_ZIP_ENTRY_BYTES) throw new Error("压缩包中存在过大的文件");
        total += data.byteLength;
        if (total > MAX_ZIP_EXPANDED_BYTES) throw new Error("压缩包解压后内容过大");
    }
    return new Map(
        Object.entries(entries).map(([name, data]) => {
            const copy = Uint8Array.from(data);
            return [name, new Blob([copy.buffer])];
        }),
    );
}

function unzipAsync(data: Uint8Array) {
    return new Promise<Record<string, Uint8Array>>((resolve, reject) => {
        unzip(data, (error, entries) => {
            if (error) reject(error);
            else resolve(entries);
        });
    });
}

function isSafeZipPath(name: string) {
    return Boolean(name) && !name.startsWith("/") && !name.startsWith("\\") && !name.split(/[\\/]+/).includes("..");
}
