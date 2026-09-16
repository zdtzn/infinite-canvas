export const MEDIA_LIMITS = { maxBytes: 200 * 1024 * 1024, maxDuration: 600, minTrim: 0.5, eventTimeout: 30_000, operationTimeout: 120_000, maxPixels: 16_777_216 } as const;
export type MediaTrim = { start: number; end: number };
export type FramePosition = "first" | "current" | "last";

export function assertMediaDuration(duration: number) {
    if (!Number.isFinite(duration) || duration <= 0 || duration > MEDIA_LIMITS.maxDuration) throw new Error("媒体时长须大于 0 且不超过 10 分钟");
}

export function validateTrim(trim: MediaTrim, duration: number) {
    assertMediaDuration(duration);
    if (!Number.isFinite(trim.start) || !Number.isFinite(trim.end) || trim.start < 0 || trim.end > duration || trim.end - trim.start < MEDIA_LIMITS.minTrim) throw new Error("起止时间无效：至少保留 0.5 秒，且不能超过媒体时长");
    return trim;
}

export function frameTime(duration: number, position: FramePosition, currentTime: number) {
    assertMediaDuration(duration);
    if (position === "current" && (!Number.isFinite(currentTime) || currentTime < 0 || currentTime > duration)) throw new Error("截帧时间超出范围");
    return position === "first" ? 0 : Math.min(position === "last" ? duration : currentTime, Math.max(0, duration - 0.001));
}

export async function readLimitedMedia(response: Response, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!response.ok) throw new Error(`媒体读取失败 (${response.status})`);
    if (Number(response.headers.get("content-length")) > MEDIA_LIMITS.maxBytes) {
        await response.body?.cancel();
        throw new Error("媒体文件不能超过 200 MiB");
    }
    if (!response.body) throw new Error("媒体资源为空");
    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let size = 0;
    const cancel = () => {
        void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
        while (true) {
            signal.throwIfAborted();
            const { value, done } = await reader.read();
            signal.throwIfAborted();
            if (done) break;
            size += value.byteLength;
            if (size > MEDIA_LIMITS.maxBytes) throw new Error("媒体文件不能超过 200 MiB");
            chunks.push(value as Uint8Array<ArrayBuffer>);
        }
        if (!size) throw new Error("媒体资源为空");
        return new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" });
    } finally {
        signal.removeEventListener("abort", cancel);
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}

export function waitForMediaEvent(target: EventTarget, event: string, signal: AbortSignal, timeout: number = MEDIA_LIMITS.eventTimeout) {
    return new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        const finish = (error?: unknown) => {
            clearTimeout(timer);
            target.removeEventListener(event, loaded);
            target.removeEventListener("error", failed);
            signal.removeEventListener("abort", aborted);
            if (error) reject(error);
            else resolve();
        };
        const loaded = () => finish();
        const failed = () => finish(new Error("无法读取媒体，请检查格式或资源权限"));
        const aborted = () => finish(signal.reason || new DOMException("已取消", "AbortError"));
        const timer = setTimeout(() => finish(new Error("媒体读取超时")), timeout);
        target.addEventListener(event, loaded, { once: true });
        target.addEventListener("error", failed, { once: true });
        signal.addEventListener("abort", aborted, { once: true });
    });
}

export async function captureVideoFrame(blob: Blob, position: FramePosition, currentTime: number, signal: AbortSignal): Promise<File> {
    signal.throwIfAborted();
    if (blob.size > MEDIA_LIMITS.maxBytes) throw new Error("媒体文件不能超过 200 MiB");
    const video = document.createElement("video");
    const url = URL.createObjectURL(blob);
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    try {
        const loaded = waitForMediaEvent(video, "loadedmetadata", signal);
        video.src = url;
        video.load();
        await loaded;
        const time = frameTime(video.duration, position, currentTime);
        if (time > 0) {
            const seeked = waitForMediaEvent(video, "seeked", signal);
            video.currentTime = time;
            await seeked;
        }
        if (video.readyState < 2) await waitForMediaEvent(video, "loadeddata", signal);
        signal.throwIfAborted();
        if (!video.videoWidth || !video.videoHeight || video.videoWidth * video.videoHeight > MEDIA_LIMITS.maxPixels) throw new Error("视频尺寸无效或超过 1600 万像素限制");
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        try {
            const context = canvas.getContext("2d");
            if (!context) throw new Error("浏览器不支持截帧");
            context.drawImage(video, 0, 0);
            const result = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("截帧失败"))), "image/png"));
            signal.throwIfAborted();
            return new File([result], `视频截帧-${time.toFixed(3)}.png`, { type: "image/png" });
        } finally {
            canvas.width = canvas.height = 0;
        }
    } finally {
        video.pause();
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
    }
}

export async function extractMediaAudio(blob: Blob, trim: MediaTrim | undefined, signal: AbortSignal): Promise<File> {
    signal.throwIfAborted();
    if (blob.size > MEDIA_LIMITS.maxBytes) throw new Error("媒体文件不能超过 200 MiB");
    const { Input, ALL_FORMATS, BlobSource, Output, WavOutputFormat, BufferTarget, Conversion } = await import("mediabunny");
    signal.throwIfAborted();
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    let conversion: Awaited<ReturnType<typeof Conversion.init>> | undefined;
    const cancel = () => {
        void conversion?.cancel().catch(() => undefined);
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
        const track = await input.getPrimaryAudioTrack();
        signal.throwIfAborted();
        if (!track) throw new Error("该媒体没有音轨");
        const duration = await track.computeDuration();
        assertMediaDuration(duration);
        if (trim) validateTrim(trim, duration);
        const target = new BufferTarget();
        conversion = await Conversion.init({
            input,
            output: new Output({ format: new WavOutputFormat(), target }),
            tracks: "primary",
            trim,
            video: { discard: true },
            audio: { codec: "pcm-s16", sampleRate: 44100, numberOfChannels: 2 },
        });
        signal.throwIfAborted();
        if (!conversion.isValid) throw new Error("当前浏览器无法解码该媒体的音频");
        await conversion.execute();
        signal.throwIfAborted();
        if (!target.buffer?.byteLength) throw new Error("音频输出为空");
        return new File([target.buffer], trim ? "音频裁剪.wav" : "提取音频.wav", { type: "audio/wav" });
    } finally {
        signal.removeEventListener("abort", cancel);
        await conversion?.cancel().catch(() => undefined);
        input.dispose();
    }
}
