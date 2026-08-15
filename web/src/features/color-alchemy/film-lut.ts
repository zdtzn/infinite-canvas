export type FilmLutEntry = {
    name: string;
    category: string;
    lutFile: string;
    thumbnail: string;
};

export type FilmLut = {
    size: number;
    domainMin: [number, number, number];
    domainMax: [number, number, number];
    data: Float32Array;
};

const CATALOG_URL = "/film-luts/film_luts.json";
const ASSET_ROOT = "/film-luts/";
const CATEGORY_LABELS: Record<string, string> = {
    Bw: "黑白",
    Colorslide: "彩色反转片",
    Fujixtransiii: "Fuji X-Trans III",
    "Instant Consumer": "拍立得·消费",
    "Instant Pro": "拍立得·专业",
    "Negative Color": "彩色负片",
    "Negative New": "负片·新",
    "Negative Old": "负片·经典",
    Print: "电影打印",
};

let catalogPromise: Promise<FilmLutEntry[]> | null = null;
const lutCache = new Map<string, Promise<FilmLut>>();

export async function loadFilmLutCatalog() {
    if (!catalogPromise) {
        const task = fetch(CATALOG_URL, { cache: "force-cache" })
            .then((response) => {
                if (!response.ok) throw new Error("胶片滤镜清单加载失败");
                return response.json() as Promise<{ filmLUTs?: Array<{ name?: unknown; category?: unknown; lut_file?: unknown; thumbnail?: unknown }> }>;
            })
            .then((payload) =>
                (payload.filmLUTs || []).flatMap((item) => {
                    if (typeof item.name !== "string" || typeof item.category !== "string" || typeof item.lut_file !== "string" || typeof item.thumbnail !== "string") return [];
                    return [{ name: item.name, category: item.category, lutFile: item.lut_file, thumbnail: item.thumbnail }];
                }),
            );
        catalogPromise = task.catch((reason) => {
            catalogPromise = null;
            throw reason;
        });
    }
    return catalogPromise;
}

export async function loadFilmLut(lutFile: string | null) {
    if (!lutFile) return null;
    const catalog = await loadFilmLutCatalog();
    const entry = catalog.find((item) => item.lutFile === lutFile);
    if (!entry) throw new Error("胶片滤镜不存在");
    const cachedTask = lutCache.get(lutFile);
    if (cachedTask) return cachedTask;

    const task = fetch(staticFilmLutUrl(entry.lutFile), { cache: "force-cache" })
        .then((response) => {
            if (!response.ok) throw new Error("胶片滤镜加载失败");
            return response.text();
        })
        .then(parseCubeLut);
    const retryableTask = task.catch((reason) => {
        if (lutCache.get(lutFile) === retryableTask) lutCache.delete(lutFile);
        throw reason;
    });
    lutCache.set(lutFile, retryableTask);
    return retryableTask;
}

export function parseCubeLut(source: string): FilmLut {
    let size = 0;
    const domainMin: [number, number, number] = [0, 0, 0];
    const domainMax: [number, number, number] = [1, 1, 1];
    const values: number[] = [];

    for (const rawLine of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
        const line = rawLine.replace(/#.*/, "").trim();
        if (!line) continue;
        const parts = line.split(/\s+/);
        if (parts[0] === "LUT_3D_SIZE") {
            size = Number(parts[1]);
            continue;
        }
        if (parts[0] === "DOMAIN_MIN" || parts[0] === "DOMAIN_MAX") {
            const target = parts[0] === "DOMAIN_MIN" ? domainMin : domainMax;
            target[0] = Number(parts[1]);
            target[1] = Number(parts[2]);
            target[2] = Number(parts[3]);
            continue;
        }
        if (parts.length < 3 || !parts.slice(0, 3).every((part) => Number.isFinite(Number(part)))) continue;
        values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
    }

    if (!Number.isInteger(size) || size < 2 || size > 65) throw new Error("不支持的 3D LUT 尺寸");
    if (values.length !== size ** 3 * 3) throw new Error("3D LUT 数据不完整");
    if (domainMax.some((value, index) => value <= domainMin[index])) throw new Error("3D LUT 色域范围无效");
    return { size, domainMin, domainMax, data: new Float32Array(values) };
}

export function sampleFilmLut(lut: FilmLut, red: number, green: number, blue: number, output = new Float32Array(3)) {
    const coordinates = [red, green, blue].map((value, index) => {
        const range = lut.domainMax[index] - lut.domainMin[index];
        return clamp(((value - lut.domainMin[index]) / range) * (lut.size - 1), 0, lut.size - 1);
    });
    const floors = coordinates.map(Math.floor);
    const fractions = coordinates.map((value, index) => value - floors[index]);
    const sample = (r: number, g: number, b: number, channel: number) => lut.data[(r + lut.size * (g + lut.size * b)) * 3 + channel];

    for (let channel = 0; channel < 3; channel += 1) {
        const c000 = sample(floors[0], floors[1], floors[2], channel);
        const c100 = sample(Math.min(floors[0] + 1, lut.size - 1), floors[1], floors[2], channel);
        const c010 = sample(floors[0], Math.min(floors[1] + 1, lut.size - 1), floors[2], channel);
        const c110 = sample(Math.min(floors[0] + 1, lut.size - 1), Math.min(floors[1] + 1, lut.size - 1), floors[2], channel);
        const c001 = sample(floors[0], floors[1], Math.min(floors[2] + 1, lut.size - 1), channel);
        const c101 = sample(Math.min(floors[0] + 1, lut.size - 1), floors[1], Math.min(floors[2] + 1, lut.size - 1), channel);
        const c011 = sample(floors[0], Math.min(floors[1] + 1, lut.size - 1), Math.min(floors[2] + 1, lut.size - 1), channel);
        const c111 = sample(Math.min(floors[0] + 1, lut.size - 1), Math.min(floors[1] + 1, lut.size - 1), Math.min(floors[2] + 1, lut.size - 1), channel);
        const x00 = mix(c000, c100, fractions[0]);
        const x10 = mix(c010, c110, fractions[0]);
        const x01 = mix(c001, c101, fractions[0]);
        const x11 = mix(c011, c111, fractions[0]);
        output[channel] = mix(mix(x00, x10, fractions[1]), mix(x01, x11, fractions[1]), fractions[2]);
    }
    return output;
}

export function staticFilmLutUrl(path: string) {
    return `${ASSET_ROOT}${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function filmLutCategoryLabel(category: string) {
    return CATEGORY_LABELS[category] || category;
}

function mix(left: number, right: number, amount: number) {
    return left + (right - left) * amount;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
