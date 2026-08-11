import { useEffect, useRef, useState } from "react";
import type { Mesh, Renderer } from "ogl";

import { cn } from "@/lib/utils";

import "./light-rays.css";

export type LightRaysOrigin = "top-center" | "top-left" | "top-right" | "right" | "left" | "bottom-center" | "bottom-right" | "bottom-left";

export type LightRaysProps = {
    raysOrigin?: LightRaysOrigin;
    raysColor?: string;
    raysSpeed?: number;
    lightSpread?: number;
    rayLength?: number;
    pulsating?: boolean;
    fadeDistance?: number;
    saturation?: number;
    followMouse?: boolean;
    mouseInfluence?: number;
    noiseAmount?: number;
    distortion?: number;
    className?: string;
};

type Uniform<T> = { value: T };

type LightRaysUniforms = {
    iTime: Uniform<number>;
    iResolution: Uniform<[number, number]>;
    rayPos: Uniform<[number, number]>;
    rayDir: Uniform<[number, number]>;
    raysColor: Uniform<[number, number, number]>;
    raysSpeed: Uniform<number>;
    lightSpread: Uniform<number>;
    rayLength: Uniform<number>;
    pulsating: Uniform<number>;
    fadeDistance: Uniform<number>;
    saturation: Uniform<number>;
    mousePos: Uniform<[number, number]>;
    mouseInfluence: Uniform<number>;
    noiseAmount: Uniform<number>;
    distortion: Uniform<number>;
};

const VERTEX_SHADER = `
attribute vec2 position;
varying vec2 vUv;

void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform vec2 rayPos;
uniform vec2 rayDir;
uniform vec3 raysColor;
uniform float raysSpeed;
uniform float lightSpread;
uniform float rayLength;
uniform float pulsating;
uniform float fadeDistance;
uniform float saturation;
uniform vec2 mousePos;
uniform float mouseInfluence;
uniform float noiseAmount;
uniform float distortion;

varying vec2 vUv;

float noise(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord, float seedA, float seedB, float speed) {
  vec2 sourceToCoord = coord - raySource;
  vec2 dirNorm = normalize(sourceToCoord);
  float cosAngle = dot(dirNorm, rayRefDirection);
  float distortedAngle = cosAngle + distortion * sin(iTime * 2.0 + length(sourceToCoord) * 0.01) * 0.2;
  float spreadFactor = pow(max(distortedAngle, 0.0), 1.0 / max(lightSpread, 0.001));
  float distanceToSource = length(sourceToCoord);
  float maxDistance = iResolution.x * rayLength;
  float lengthFalloff = clamp((maxDistance - distanceToSource) / maxDistance, 0.0, 1.0);
  float fadeFalloff = clamp((iResolution.x * fadeDistance - distanceToSource) / (iResolution.x * fadeDistance), 0.5, 1.0);
  float pulse = pulsating > 0.5 ? 0.8 + 0.2 * sin(iTime * speed * 3.0) : 1.0;
  float baseStrength = clamp(
    (0.45 + 0.15 * sin(distortedAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-distortedAngle * seedB + iTime * speed)),
    0.0,
    1.0
  );

  return baseStrength * lengthFalloff * fadeFalloff * spreadFactor * pulse;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);
  vec2 finalRayDir = rayDir;

  if (mouseInfluence > 0.0) {
    vec2 mouseScreenPos = mousePos * iResolution.xy;
    vec2 mouseDirection = normalize(mouseScreenPos - rayPos);
    finalRayDir = normalize(mix(rayDir, mouseDirection, mouseInfluence));
  }

  vec4 rays1 = vec4(1.0) * rayStrength(rayPos, finalRayDir, coord, 36.2214, 21.11349, 1.5 * raysSpeed);
  vec4 rays2 = vec4(1.0) * rayStrength(rayPos, finalRayDir, coord, 22.3991, 18.0234, 1.1 * raysSpeed);
  fragColor = rays1 * 0.5 + rays2 * 0.4;

  if (noiseAmount > 0.0) {
    float n = noise(coord * 0.01 + iTime * 0.1);
    fragColor.rgb *= 1.0 - noiseAmount + noiseAmount * n;
  }

  float brightness = 1.0 - coord.y / iResolution.y;
  fragColor.x *= 0.1 + brightness * 0.8;
  fragColor.y *= 0.3 + brightness * 0.6;
  fragColor.z *= 0.5 + brightness * 0.5;

  if (saturation != 1.0) {
    float gray = dot(fragColor.rgb, vec3(0.299, 0.587, 0.114));
    fragColor.rgb = mix(vec3(gray), fragColor.rgb, saturation);
  }

  fragColor.rgb *= raysColor;
}

void main() {
  vec4 color;
  mainImage(color, gl_FragCoord.xy);
  gl_FragColor = color;
}`;

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

export function hexToRgb(hex: string): [number, number, number] {
    const normalized = hex.trim().replace(/^#/, "");
    const expanded = normalized.length === 3 ? normalized.replace(/./g, (value) => value + value) : normalized;
    const match = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(expanded);
    return match ? [parseInt(match[1], 16) / 255, parseInt(match[2], 16) / 255, parseInt(match[3], 16) / 255] : [1, 1, 1];
}

export function getLightRayAnchor(origin: LightRaysOrigin, width: number, height: number): { anchor: [number, number]; dir: [number, number] } {
    const outside = 0.2;
    switch (origin) {
        case "top-left":
            return { anchor: [0, -outside * height], dir: [0, 1] };
        case "top-right":
            return { anchor: [width, -outside * height], dir: [0, 1] };
        case "left":
            return { anchor: [-outside * width, 0.5 * height], dir: [1, 0] };
        case "right":
            return { anchor: [(1 + outside) * width, 0.5 * height], dir: [-1, 0] };
        case "bottom-left":
            return { anchor: [0, (1 + outside) * height], dir: [0, -1] };
        case "bottom-center":
            return { anchor: [0.5 * width, (1 + outside) * height], dir: [0, -1] };
        case "bottom-right":
            return { anchor: [width, (1 + outside) * height], dir: [0, -1] };
        default:
            return { anchor: [0.5 * width, -outside * height], dir: [0, 1] };
    }
}

export function LightRays({
    raysOrigin = "top-center",
    raysColor = "#ffffff",
    raysSpeed = 1,
    lightSpread = 1,
    rayLength = 2,
    pulsating = false,
    fadeDistance = 1,
    saturation = 1,
    followMouse = true,
    mouseInfluence = 0.1,
    noiseAmount = 0,
    distortion = 0,
    className,
}: LightRaysProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const rendererRef = useRef<Renderer | null>(null);
    const uniformsRef = useRef<LightRaysUniforms | null>(null);
    const meshRef = useRef<Mesh | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const mouseRef = useRef({ x: 0.5, y: 0.5 });
    const smoothMouseRef = useRef({ x: 0.5, y: 0.5 });
    const [isVisible, setIsVisible] = useState(() => typeof IntersectionObserver === "undefined");
    const [isPageVisible, setIsPageVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
    const [reduceMotion, setReduceMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

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

    useEffect(() => {
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        const handleChange = () => setReduceMotion(media.matches);
        media.addEventListener("change", handleChange);
        return () => media.removeEventListener("change", handleChange);
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !isVisible || !isPageVisible) return;
        let cancelled = false;
        let resizeObserver: ResizeObserver | null = null;

        const initialize = async () => {
            const { Renderer: OglRenderer, Program, Triangle, Mesh: OglMesh } = await import("ogl");
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            if (cancelled || !containerRef.current) return;

            const renderer = new OglRenderer({ dpr: Math.min(window.devicePixelRatio, window.innerWidth < 768 ? 1.35 : 1.8), alpha: true });
            rendererRef.current = renderer;
            const gl = renderer.gl;
            gl.canvas.style.width = "100%";
            gl.canvas.style.height = "100%";
            gl.canvas.setAttribute("aria-hidden", "true");
            container.replaceChildren(gl.canvas);

            const uniforms: LightRaysUniforms = {
                iTime: { value: 0 },
                iResolution: { value: [1, 1] },
                rayPos: { value: [0, 0] },
                rayDir: { value: [0, 1] },
                raysColor: { value: hexToRgb(raysColor) },
                raysSpeed: { value: clamp(raysSpeed, 0.05, 4) },
                lightSpread: { value: clamp(lightSpread, 0.05, 2) },
                rayLength: { value: clamp(rayLength, 0.1, 4) },
                pulsating: { value: pulsating ? 1 : 0 },
                fadeDistance: { value: clamp(fadeDistance, 0.1, 4) },
                saturation: { value: clamp(saturation, 0, 2) },
                mousePos: { value: [0.5, 0.5] },
                mouseInfluence: { value: reduceMotion ? 0 : clamp(mouseInfluence, 0, 1) },
                noiseAmount: { value: clamp(noiseAmount, 0, 1) },
                distortion: { value: clamp(distortion, 0, 1) },
            };
            uniformsRef.current = uniforms;

            const geometry = new Triangle(gl);
            const program = new Program(gl, { vertex: VERTEX_SHADER, fragment: FRAGMENT_SHADER, uniforms });
            const mesh = new OglMesh(gl, { geometry, program });
            meshRef.current = mesh;

            const updatePlacement = () => {
                const activeContainer = containerRef.current;
                if (!activeContainer || !rendererRef.current) return;
                renderer.dpr = Math.min(window.devicePixelRatio, window.innerWidth < 768 ? 1.35 : 1.8);
                const width = Math.max(activeContainer.clientWidth, 1);
                const height = Math.max(activeContainer.clientHeight, 1);
                renderer.setSize(width, height);
                const resolution: [number, number] = [width * renderer.dpr, height * renderer.dpr];
                uniforms.iResolution.value = resolution;
                const placement = getLightRayAnchor(raysOrigin, resolution[0], resolution[1]);
                uniforms.rayPos.value = placement.anchor;
                uniforms.rayDir.value = placement.dir;
            };

            const handlePointerMove = (event: PointerEvent) => {
                const activeContainer = containerRef.current;
                if (!activeContainer) return;
                const rect = activeContainer.getBoundingClientRect();
                mouseRef.current = { x: (event.clientX - rect.left) / Math.max(rect.width, 1), y: (event.clientY - rect.top) / Math.max(rect.height, 1) };
            };

            const render = (time: number) => {
                if (cancelled || !rendererRef.current || !uniformsRef.current || !meshRef.current) return;
                uniforms.iTime.value = time * 0.001;
                if (followMouse && !reduceMotion && mouseInfluence > 0) {
                    const smoothing = 0.92;
                    smoothMouseRef.current.x = smoothMouseRef.current.x * smoothing + mouseRef.current.x * (1 - smoothing);
                    smoothMouseRef.current.y = smoothMouseRef.current.y * smoothing + mouseRef.current.y * (1 - smoothing);
                    uniforms.mousePos.value = [smoothMouseRef.current.x, smoothMouseRef.current.y];
                }
                renderer.render({ scene: mesh });
                if (!reduceMotion) animationFrameRef.current = requestAnimationFrame(render);
            };

            resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePlacement);
            resizeObserver?.observe(container);
            window.addEventListener("resize", updatePlacement);
            if (followMouse && !reduceMotion) window.addEventListener("pointermove", handlePointerMove, { passive: true });
            updatePlacement();
            animationFrameRef.current = requestAnimationFrame(render);

            return () => {
                window.removeEventListener("resize", updatePlacement);
                window.removeEventListener("pointermove", handlePointerMove);
            };
        };

        let removeListeners: (() => void) | undefined;
        void initialize().then((cleanup) => {
            removeListeners = cleanup;
            if (cancelled) cleanup?.();
        });

        return () => {
            cancelled = true;
            removeListeners?.();
            resizeObserver?.disconnect();
            if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
            const renderer = rendererRef.current;
            if (renderer) {
                const canvas = renderer.gl.canvas;
                renderer.gl.getExtension("WEBGL_lose_context")?.loseContext();
                canvas.remove();
            }
            rendererRef.current = null;
            uniformsRef.current = null;
            meshRef.current = null;
        };
    }, [distortion, fadeDistance, followMouse, isPageVisible, isVisible, lightSpread, mouseInfluence, noiseAmount, pulsating, rayLength, raysColor, raysOrigin, raysSpeed, reduceMotion, saturation]);

    return <div ref={containerRef} className={cn("light-rays-container", className)} aria-hidden="true" />;
}

export default LightRays;
