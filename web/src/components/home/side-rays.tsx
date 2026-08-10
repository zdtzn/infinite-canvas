import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

import "./side-rays.css";

export type SideRaysOrigin = "top-right" | "top-left" | "bottom-right" | "bottom-left";

type SideRaysStyle = CSSProperties & Record<`--side-rays-${string}`, string | number>;

export type SideRaysProps = {
    speed?: number;
    rayColor1?: string;
    rayColor2?: string;
    intensity?: number;
    spread?: number;
    origin?: SideRaysOrigin;
    tilt?: number;
    opacity?: number;
    className?: string;
};

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

export function sideRaysAnimationDuration(speed: number) {
    return clamp(32 / Math.max(speed, 0.1), 14, 72);
}

export function SideRays({ speed = 1, rayColor1 = "#e7c878", rayColor2 = "#9ebed2", intensity = 1, spread = 1, origin = "top-right", tilt = 0, opacity = 0.55, className }: SideRaysProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [isVisible, setIsVisible] = useState(() => typeof IntersectionObserver === "undefined");
    const [isPageVisible, setIsPageVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");

    useEffect(() => {
        const container = containerRef.current;
        if (!container || typeof IntersectionObserver === "undefined") return;

        const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.isIntersecting), { threshold: 0.08 });
        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const handleVisibilityChange = () => setIsPageVisible(document.visibilityState !== "hidden");
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }, []);

    const safeOpacity = clamp(opacity, 0, 1);
    const safeIntensity = clamp(intensity, 0, 2.5);
    const sideRaysStyle = useMemo<SideRaysStyle>(() => {
        const duration = sideRaysAnimationDuration(speed);
        return {
            "--side-rays-color-1": rayColor1,
            "--side-rays-color-2": rayColor2,
            "--side-rays-duration": `${duration}s`,
            "--side-rays-delay-2": `${-(duration * 0.36)}s`,
            "--side-rays-delay-3": `${-(duration * 0.68)}s`,
            "--side-rays-spread": clamp(spread, 0.72, 1.65),
            "--side-rays-tilt": `${clamp(tilt, -35, 35)}deg`,
            "--side-rays-source-opacity": clamp(safeOpacity * safeIntensity * 0.22, 0, 0.28),
            "--side-rays-beam-1-opacity": clamp(safeOpacity * safeIntensity * 0.22, 0, 0.25),
            "--side-rays-beam-2-opacity": clamp(safeOpacity * safeIntensity * 0.14, 0, 0.18),
            "--side-rays-beam-3-opacity": clamp(safeOpacity * safeIntensity * 0.08, 0, 0.12),
        };
    }, [rayColor1, rayColor2, safeIntensity, safeOpacity, speed, spread, tilt]);

    return (
        <div ref={containerRef} className={cn("side-rays", `side-rays--${origin}`, (!isVisible || !isPageVisible) && "is-paused", className)} style={sideRaysStyle} aria-hidden="true">
            <div className="side-rays__field">
                <span className="side-rays__source" />
                <span className="side-rays__beam side-rays__beam--one" />
                <span className="side-rays__beam side-rays__beam--two" />
                <span className="side-rays__beam side-rays__beam--three" />
            </div>
        </div>
    );
}

export default SideRays;
