import { useEffect, useRef, useState, type CSSProperties } from "react";

import { canvasThemes, type CanvasColorTheme } from "@/lib/canvas-theme";

export const CANVAS_CINEMATIC_VIDEO_URL = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260406_094145_4a271a6c-3869-4f1c-8aa7-aeb0cb227994.mp4";

export function CanvasCinematicBackdrop({ enabled, colorTheme }: { enabled: boolean; colorTheme: CanvasColorTheme }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [videoReady, setVideoReady] = useState(false);
    const [videoFailed, setVideoFailed] = useState(false);
    const [reduceMotion, setReduceMotion] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const theme = canvasThemes[colorTheme];

    useEffect(() => {
        if (typeof window.matchMedia !== "function") return;
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        const update = () => setReduceMotion(media.matches);
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || reduceMotion || !enabled) return;

        const syncPlayback = () => {
            if (document.hidden) {
                video.pause();
                return;
            }
            void video.play().catch(() => undefined);
        };

        document.addEventListener("visibilitychange", syncPlayback);
        syncPlayback();
        return () => document.removeEventListener("visibilitychange", syncPlayback);
    }, [enabled, reduceMotion]);

    if (!enabled) return null;

    const style = {
        background: theme.canvas.background,
        "--canvas-cinematic-video-opacity": colorTheme === "dark" ? 0.48 : 0.2,
    } as CSSProperties;

    return (
        <div className="canvas-cinematic-backdrop" style={style} aria-hidden="true" data-video-state={videoFailed ? "failed" : videoReady ? "ready" : "loading"}>
            {!reduceMotion && !videoFailed ? (
                <video
                    ref={videoRef}
                    className="canvas-cinematic-video"
                    src={CANVAS_CINEMATIC_VIDEO_URL}
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    disablePictureInPicture
                    onLoadedData={() => setVideoReady(true)}
                    onError={() => setVideoFailed(true)}
                />
            ) : null}
            <div className="canvas-cinematic-wash" />
            <div className="canvas-bottom-blur" />
        </div>
    );
}
