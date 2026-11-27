import { fitImageWithinEdge } from "@/services/image-storage";

export type EditPoint = { x: number; y: number };
export type EditSelection =
    | { mode: "box"; start: EditPoint; end: EditPoint }
    | { mode: "brush"; points: EditPoint[]; diameter: number };
export type EditRegion = { id: string; selection: EditSelection; note: string };
export type LocalImageEdit = {
    mask: Blob;
    guide?: Blob;
    text: string;
    size: { width: number; height: number };
};

type ImageSize = { width: number; height: number };
type Bounds = { left: number; top: number; right: number; bottom: number };

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function selectionBounds(selection: EditSelection, { width, height }: ImageSize): Bounds {
    const points = selection.mode === "box" ? [selection.start, selection.end] : selection.points;
    const diameter = selection.mode === "brush" ? selection.diameter * Math.min(width, height) : 0;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
        left: clamp(Math.min(...xs) - diameter / (2 * width)),
        top: clamp(Math.min(...ys) - diameter / (2 * height)),
        right: clamp(Math.max(...xs) + diameter / (2 * width)),
        bottom: clamp(Math.max(...ys) + diameter / (2 * height)),
    };
}

export function drawEditSelection(context: CanvasRenderingContext2D, selection: EditSelection, { width, height }: ImageSize) {
    if (selection.mode === "box") {
        const { left, top, right, bottom } = selectionBounds(selection, { width, height });
        context.fillRect(left * width, top * height, (right - left) * width, (bottom - top) * height);
        return;
    }

    const [start, ...rest] = selection.points;
    if (!start) return;
    context.lineWidth = selection.diameter * Math.min(width, height);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    if (!rest.length) {
        context.arc(start.x * width, start.y * height, context.lineWidth / 2, 0, Math.PI * 2);
        context.fill();
        return;
    }
    context.moveTo(start.x * width, start.y * height);
    for (const point of rest) context.lineTo(point.x * width, point.y * height);
    context.stroke();
}

export function localEditPrompt(regions: EditRegion[], size: ImageSize, includeGuide: boolean) {
    const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
    const instructions = regions.map(({ selection, note }, index) => {
        const area = selectionBounds(selection, size);
        return `区域 ${index + 1}（横向 ${percent(area.left)}–${percent(area.right)}，纵向 ${percent(area.top)}–${percent(area.bottom)}）：${note.trim()}`;
    });
    return [
        "编辑图片1。只修改蒙版里透明的区域，保留其它位置、画面比例和原有细节。坐标从第一张图片的左上角开始。",
        includeGuide ? "图片2是在同一张原图上标记的选区编号图。按编号对应以下注释，输出时去掉所有示意编号、涂色和标线。" : "",
        ...instructions,
    ].filter(Boolean).join("\n");
}

export function localEditRatio(width: number, height: number, sizes: string[]) {
    const originalRatio = width / height;
    let closest = "1:1";
    let distance = Infinity;
    for (const size of sizes) {
        const [w, h] = size.split(":").map(Number);
        const next = Math.abs(Math.log(w / h / originalRatio));
        if (next < distance) {
            closest = size;
            distance = next;
        }
    }
    return closest;
}

export async function encodeLocalImageEdit(image: HTMLImageElement, regions: EditRegion[], withGuide: boolean): Promise<LocalImageEdit> {
    const size = { width: image.naturalWidth, height: image.naturalHeight };
    const mask = await renderPng(size, (context) => {
        context.fillStyle = "white";
        context.fillRect(0, 0, size.width, size.height);
        context.globalCompositeOperation = "destination-out";
        context.fillStyle = "black";
        context.strokeStyle = "black";
        for (const region of regions) drawEditSelection(context, region.selection, size);
    });
    const includeGuide = withGuide && regions.length > 1;
    let guide: Blob | undefined;
    if (includeGuide) {
        const guideSize = fitImageWithinEdge(size.width, size.height, 1024);
        guide = await renderPng(guideSize, (context) => {
            const { width, height } = guideSize;
            context.drawImage(image, 0, 0, width, height);
            const radius = Math.max(9, Math.round(Math.min(width, height) * 0.026));
            for (const { selection } of regions) {
                context.fillStyle = "rgba(14, 130, 216, .32)";
                context.strokeStyle = context.fillStyle;
                drawEditSelection(context, selection, guideSize);
            }
            regions.forEach(({ selection }, index) => {
                const { left, top } = selectionBounds(selection, size);
                const x = Math.max(radius, Math.min(width - radius, left * width + radius));
                const y = Math.max(radius, Math.min(height - radius, top * height + radius));
                context.beginPath();
                context.arc(x, y, radius, 0, 2 * Math.PI);
                context.fillStyle = "#124c82";
                context.fill();
                context.fillStyle = "white";
                context.font = `bold ${radius}px sans-serif`;
                context.textAlign = "center";
                context.textBaseline = "middle";
                context.fillText(String(index + 1), x, y);
            });
        });
    }
    return { mask, guide, text: localEditPrompt(regions, size, includeGuide), size };
}

async function renderPng(size: ImageSize, draw: (context: CanvasRenderingContext2D) => void) {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    try {
        const context = canvas.getContext("2d");
        if (!context) throw new Error("当前浏览器无法绘制选区");
        draw(context);
        return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("选区图片无法保存，请重试")), "image/png");
        });
    } finally {
        canvas.width = 1;
        canvas.height = 1;
    }
}
