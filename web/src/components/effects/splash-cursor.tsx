import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import "./splash-cursor.css";

type FluidColor = { r: number; g: number; b: number };

export type SplashCursorProps = {
    SIM_RESOLUTION?: number;
    DYE_RESOLUTION?: number;
    CAPTURE_RESOLUTION?: number;
    DENSITY_DISSIPATION?: number;
    VELOCITY_DISSIPATION?: number;
    PRESSURE?: number;
    PRESSURE_ITERATIONS?: number;
    CURL?: number;
    SPLAT_RADIUS?: number;
    SPLAT_FORCE?: number;
    SHADING?: boolean;
    COLOR_UPDATE_SPEED?: number;
    BACK_COLOR?: FluidColor;
    TRANSPARENT?: boolean;
    RAINBOW_MODE?: boolean;
    COLOR?: string;
    MAX_PIXEL_RATIO?: number;
    IDLE_TIMEOUT_MS?: number;
    enabled?: boolean;
    className?: string;
};

type PointerState = {
    initialized: boolean;
    texcoordX: number;
    texcoordY: number;
    prevTexcoordX: number;
    prevTexcoordY: number;
    deltaX: number;
    deltaY: number;
    moved: boolean;
    color: FluidColor;
};

type TextureFormat = { internalFormat: number; format: number };
type UniformMap = Record<string, WebGLUniformLocation | null>;
type GL = WebGLRenderingContext | WebGL2RenderingContext;

type Framebuffer = {
    texture: WebGLTexture;
    fbo: WebGLFramebuffer;
    width: number;
    height: number;
    texelSizeX: number;
    texelSizeY: number;
    attach: (id: number) => number;
};

type DoubleFramebuffer = {
    width: number;
    height: number;
    texelSizeX: number;
    texelSizeY: number;
    read: Framebuffer;
    write: Framebuffer;
    swap: () => void;
};

type ProgramBundle = {
    program: WebGLProgram;
    uniforms: UniformMap;
    bind: () => void;
};

type ReusableFluidContext = {
    FRAMEBUFFER: number;
    COLOR_BUFFER_BIT: number;
    isContextLost: () => boolean;
    bindFramebuffer: (target: number, framebuffer: WebGLFramebuffer | null) => void;
    viewport: (x: number, y: number, width: number, height: number) => void;
    clearColor: (red: number, green: number, blue: number, alpha: number) => void;
    clear: (mask: number) => void;
};

export function clearFluidContextForReuse(gl: ReusableFluidContext, width: number, height: number) {
    if (gl.isContextLost()) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return true;
}

const BASE_VERTEX_SHADER = `
precision highp float;
attribute vec2 aPosition;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform vec2 texelSize;

void main () {
    vUv = aPosition * 0.5 + 0.5;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const COPY_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
uniform sampler2D uTexture;

void main () {
    gl_FragColor = texture2D(uTexture, vUv);
}`;

const CLEAR_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
uniform sampler2D uTexture;
uniform float value;

void main () {
    gl_FragColor = value * texture2D(uTexture, vUv);
}`;

const DISPLAY_SHADER = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uTexture;
uniform vec2 texelSize;
uniform vec3 backColor;
uniform float transparentMode;

void main () {
    vec3 c = texture2D(uTexture, vUv).rgb;
#ifdef SHADING
    vec3 lc = texture2D(uTexture, vL).rgb;
    vec3 rc = texture2D(uTexture, vR).rgb;
    vec3 tc = texture2D(uTexture, vT).rgb;
    vec3 bc = texture2D(uTexture, vB).rgb;
    float dx = length(rc) - length(lc);
    float dy = length(tc) - length(bc);
    vec3 n = normalize(vec3(dx, dy, length(texelSize)));
    float diffuse = clamp(dot(n, vec3(0.0, 0.0, 1.0)) + 0.7, 0.7, 1.0);
    c *= diffuse;
#endif
    float a = max(c.r, max(c.g, c.b));
    if (transparentMode < 0.5) {
        c += backColor * (1.0 - a);
        a = 1.0;
    }
    gl_FragColor = vec4(c, a);
}`;

const SPLAT_SHADER = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;

void main () {
    vec2 p = vUv - point.xy;
    p.x *= aspectRatio;
    vec3 splat = exp(-dot(p, p) / radius) * color;
    vec3 base = texture2D(uTarget, vUv).xyz;
    gl_FragColor = vec4(base + splat, 1.0);
}`;

const ADVECTION_SHADER = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform vec2 dyeTexelSize;
uniform float dt;
uniform float dissipation;

vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
    vec2 st = uv / tsize - 0.5;
    vec2 iuv = floor(st);
    vec2 fuv = fract(st);
    vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
    vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
    vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
    vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
    return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}

void main () {
#ifdef MANUAL_FILTERING
    vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
    vec4 result = bilerp(uSource, coord, dyeTexelSize);
#else
    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
    vec4 result = texture2D(uSource, coord);
#endif
    gl_FragColor = result / (1.0 + dissipation * dt);
}`;

const DIVERGENCE_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;

void main () {
    float L = texture2D(uVelocity, vL).x;
    float R = texture2D(uVelocity, vR).x;
    float T = texture2D(uVelocity, vT).y;
    float B = texture2D(uVelocity, vB).y;
    vec2 C = texture2D(uVelocity, vUv).xy;
    if (vL.x < 0.0) L = -C.x;
    if (vR.x > 1.0) R = -C.x;
    if (vT.y > 1.0) T = -C.y;
    if (vB.y < 0.0) B = -C.y;
    gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

const CURL_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;

void main () {
    float L = texture2D(uVelocity, vL).y;
    float R = texture2D(uVelocity, vR).y;
    float T = texture2D(uVelocity, vT).x;
    float B = texture2D(uVelocity, vB).x;
    gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`;

const VORTICITY_SHADER = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;

void main () {
    float L = texture2D(uCurl, vL).x;
    float R = texture2D(uCurl, vR).x;
    float T = texture2D(uCurl, vT).x;
    float B = texture2D(uCurl, vB).x;
    float C = texture2D(uCurl, vUv).x;
    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= curl * C;
    force.y *= -1.0;
    vec2 velocity = texture2D(uVelocity, vUv).xy + force * dt;
    velocity = min(max(velocity, -1000.0), 1000.0);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
}`;

const PRESSURE_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;

void main () {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    float divergence = texture2D(uDivergence, vUv).x;
    float pressure = (L + R + B + T - divergence) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}`;

const GRADIENT_SUBTRACT_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;

void main () {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity.xy -= vec2(R - L, T - B);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
}`;

function canAnimateFluidCursor() {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches && window.matchMedia("(pointer: fine)").matches;
}

function clamp(value: number, minimum: number, maximum: number) {
    return Math.min(Math.max(value, minimum), maximum);
}

function hexToColor(hex: string): FluidColor {
    const normalized = hex.trim().replace(/^#/, "");
    const expanded = normalized.length === 3 ? normalized.replace(/./g, (value) => `${value}${value}`) : normalized;
    const match = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(expanded);
    if (!match) return { r: 1, g: 0, b: 0 };
    return { r: parseInt(match[1], 16) / 255, g: parseInt(match[2], 16) / 255, b: parseInt(match[3], 16) / 255 };
}

function hsvToRgb(hue: number): FluidColor {
    const index = Math.floor(hue * 6);
    const fraction = hue * 6 - index;
    const falling = 1 - fraction;
    switch (index % 6) {
        case 0:
            return { r: 1, g: fraction, b: 0 };
        case 1:
            return { r: falling, g: 1, b: 0 };
        case 2:
            return { r: 0, g: 1, b: fraction };
        case 3:
            return { r: 0, g: falling, b: 1 };
        case 4:
            return { r: fraction, g: 0, b: 1 };
        default:
            return { r: 1, g: 0, b: falling };
    }
}

export function SplashCursor({
    SIM_RESOLUTION = 96,
    DYE_RESOLUTION = 640,
    CAPTURE_RESOLUTION = 512,
    DENSITY_DISSIPATION = 4,
    VELOCITY_DISSIPATION = 2.2,
    PRESSURE = 0.1,
    PRESSURE_ITERATIONS = 12,
    CURL = 4,
    SPLAT_RADIUS = 0.025,
    SPLAT_FORCE = 4000,
    SHADING = true,
    COLOR_UPDATE_SPEED = 8,
    BACK_COLOR = { r: 0, g: 0, b: 0 },
    TRANSPARENT = true,
    RAINBOW_MODE = true,
    COLOR = "#ebba20",
    MAX_PIXEL_RATIO = 1.5,
    IDLE_TIMEOUT_MS = 2400,
    enabled = true,
    className,
}: SplashCursorProps) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const contextRecoveryCountRef = useRef(0);
    const [environmentEnabled, setEnvironmentEnabled] = useState(false);
    const [canvasEpoch, setCanvasEpoch] = useState(0);

    useEffect(() => {
        if (typeof window.matchMedia !== "function") return;
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        const finePointer = window.matchMedia("(pointer: fine)");
        const sync = () => setEnvironmentEnabled(canAnimateFluidCursor());
        sync();
        reducedMotion.addEventListener?.("change", sync);
        finePointer.addEventListener?.("change", sync);
        return () => {
            reducedMotion.removeEventListener?.("change", sync);
            finePointer.removeEventListener?.("change", sync);
        };
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !enabled || !environmentEnabled) return;
        void CAPTURE_RESOLUTION;

        const context = createFluidContext(canvas);
        if (!context) return;
        const { gl, halfFloatTexType, supportLinearFiltering, formatRGBA, formatRG, formatR } = context;
        let active = true;
        let contextRecoveryTimer: number | null = null;
        let pageVisible = document.visibilityState !== "hidden";
        let running = false;
        let lastUpdateTime = performance.now();
        let lastInteractionTime = 0;
        let colorUpdateTimer = 0;
        let dye: DoubleFramebuffer | null = null;
        let velocity: DoubleFramebuffer | null = null;
        let divergence: Framebuffer | null = null;
        let curlTarget: Framebuffer | null = null;
        let pressure: DoubleFramebuffer | null = null;

        const config = {
            simResolution: clamp(Math.round(SIM_RESOLUTION), 32, 256),
            dyeResolution: clamp(Math.round(DYE_RESOLUTION), 128, window.innerWidth < 768 ? 384 : 1024),
            densityDissipation: clamp(DENSITY_DISSIPATION, 0.1, 10),
            velocityDissipation: clamp(VELOCITY_DISSIPATION, 0.1, 10),
            pressure: clamp(PRESSURE, 0, 1),
            pressureIterations: clamp(Math.round(PRESSURE_ITERATIONS), 1, 30),
            curl: clamp(CURL, 0, 50),
            splatRadius: clamp(SPLAT_RADIUS, 0.005, 1),
            splatForce: clamp(SPLAT_FORCE, 100, 10000),
            colorUpdateSpeed: clamp(COLOR_UPDATE_SPEED, 0.1, 30),
            maxPixelRatio: clamp(MAX_PIXEL_RATIO, 1, 2),
            idleTimeoutMs: clamp(IDLE_TIMEOUT_MS, 800, 6000),
        };

        const pointer: PointerState = {
            initialized: false,
            texcoordX: 0,
            texcoordY: 0,
            prevTexcoordX: 0,
            prevTexcoordY: 0,
            deltaX: 0,
            deltaY: 0,
            moved: false,
            color: { r: 0, g: 0, b: 0 },
        };

        const generateColor = () => {
            const base = RAINBOW_MODE ? hsvToRgb(Math.random()) : hexToColor(COLOR);
            return { r: base.r * 0.28, g: base.g * 0.28, b: base.b * 0.28 };
        };
        pointer.color = generateColor();

        let removeListeners: (() => void) | undefined;

        canvas.style.visibility = "";
        const handleContextLost = (event: Event) => {
            event.preventDefault();
            canvas.style.visibility = "hidden";
            if (!active || contextRecoveryTimer !== null || contextRecoveryCountRef.current >= 2) return;
            contextRecoveryCountRef.current += 1;
            contextRecoveryTimer = window.setTimeout(() => {
                contextRecoveryTimer = null;
                if (active) setCanvasEpoch((epoch) => epoch + 1);
            }, 50);
        };
        canvas.addEventListener("webglcontextlost", handleContextLost);

        try {
            const baseVertexShader = compileShader(gl, gl.VERTEX_SHADER, BASE_VERTEX_SHADER);
            const copyProgram = createProgramBundle(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, COPY_SHADER));
            const clearProgram = createProgramBundle(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, CLEAR_SHADER));
            const splatProgram = createProgramBundle(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, SPLAT_SHADER));
            const advectionProgram = createProgramBundle(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, ADVECTION_SHADER, supportLinearFiltering ? [] : ["MANUAL_FILTERING"]));
            const divergenceProgram = createProgramBundle(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, DIVERGENCE_SHADER));
            const curlProgram = createProgramBundle(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, CURL_SHADER));
            const vorticityProgram = createProgramBundle(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, VORTICITY_SHADER));
            const pressureProgram = createProgramBundle(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, PRESSURE_SHADER));
            const gradientProgram = createProgramBundle(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, GRADIENT_SUBTRACT_SHADER));
            const displayProgram = createProgramBundle(gl, baseVertexShader, compileShader(gl, gl.FRAGMENT_SHADER, DISPLAY_SHADER, SHADING ? ["SHADING"] : []));

            gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(0);

            const blit = (target: Framebuffer | null, clear = false) => {
                if (target) {
                    gl.viewport(0, 0, target.width, target.height);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
                } else {
                    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                }
                if (clear) {
                    gl.clearColor(0, 0, 0, TRANSPARENT ? 0 : 1);
                    gl.clear(gl.COLOR_BUFFER_BIT);
                }
                gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
            };

            const destroyFramebuffer = (target: Framebuffer | null) => {
                if (!target) return;
                gl.deleteTexture(target.texture);
                gl.deleteFramebuffer(target.fbo);
            };

            const createFramebuffer = (width: number, height: number, textureFormat: TextureFormat, filter: number): Framebuffer => {
                const texture = gl.createTexture();
                const fbo = gl.createFramebuffer();
                if (!texture || !fbo) throw new Error("Unable to allocate SplashCursor framebuffer");
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texImage2D(gl.TEXTURE_2D, 0, textureFormat.internalFormat, width, height, 0, textureFormat.format, halfFloatTexType, null);
                gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
                gl.viewport(0, 0, width, height);
                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);
                return {
                    texture,
                    fbo,
                    width,
                    height,
                    texelSizeX: 1 / width,
                    texelSizeY: 1 / height,
                    attach: (id) => {
                        gl.activeTexture(gl.TEXTURE0 + id);
                        gl.bindTexture(gl.TEXTURE_2D, texture);
                        return id;
                    },
                };
            };

            const createDoubleFramebuffer = (width: number, height: number, textureFormat: TextureFormat, filter: number): DoubleFramebuffer => {
                const target: DoubleFramebuffer = {
                    width,
                    height,
                    texelSizeX: 1 / width,
                    texelSizeY: 1 / height,
                    read: createFramebuffer(width, height, textureFormat, filter),
                    write: createFramebuffer(width, height, textureFormat, filter),
                    swap: () => {
                        const previous = target.read;
                        target.read = target.write;
                        target.write = previous;
                    },
                };
                return target;
            };

            const resizeFramebuffer = (target: Framebuffer, width: number, height: number, textureFormat: TextureFormat, filter: number) => {
                const resized = createFramebuffer(width, height, textureFormat, filter);
                copyProgram.bind();
                gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
                blit(resized);
                destroyFramebuffer(target);
                return resized;
            };

            const resizeDoubleFramebuffer = (target: DoubleFramebuffer, width: number, height: number, textureFormat: TextureFormat, filter: number) => {
                if (target.width === width && target.height === height) return target;
                target.read = resizeFramebuffer(target.read, width, height, textureFormat, filter);
                destroyFramebuffer(target.write);
                target.write = createFramebuffer(width, height, textureFormat, filter);
                target.width = width;
                target.height = height;
                target.texelSizeX = 1 / width;
                target.texelSizeY = 1 / height;
                return target;
            };

            const getResolution = (resolution: number) => {
                let aspectRatio = gl.drawingBufferWidth / Math.max(gl.drawingBufferHeight, 1);
                if (aspectRatio < 1) aspectRatio = 1 / aspectRatio;
                const minimum = Math.round(resolution);
                const maximum = Math.round(resolution * aspectRatio);
                return gl.drawingBufferWidth > gl.drawingBufferHeight ? { width: maximum, height: minimum } : { width: minimum, height: maximum };
            };

            const resizeCanvas = () => {
                const pixelRatio = Math.min(window.devicePixelRatio || 1, config.maxPixelRatio);
                const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
                const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));
                if (canvas.width === width && canvas.height === height) return false;
                canvas.width = width;
                canvas.height = height;
                return true;
            };

            const initFramebuffers = () => {
                const sim = getResolution(config.simResolution);
                const dyeSize = getResolution(config.dyeResolution);
                const filter = supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
                dye = dye ? resizeDoubleFramebuffer(dye, dyeSize.width, dyeSize.height, formatRGBA, filter) : createDoubleFramebuffer(dyeSize.width, dyeSize.height, formatRGBA, filter);
                velocity = velocity ? resizeDoubleFramebuffer(velocity, sim.width, sim.height, formatRG, filter) : createDoubleFramebuffer(sim.width, sim.height, formatRG, filter);
                destroyFramebuffer(divergence);
                destroyFramebuffer(curlTarget);
                if (pressure) {
                    destroyFramebuffer(pressure.read);
                    destroyFramebuffer(pressure.write);
                }
                divergence = createFramebuffer(sim.width, sim.height, formatR, gl.NEAREST);
                curlTarget = createFramebuffer(sim.width, sim.height, formatR, gl.NEAREST);
                pressure = createDoubleFramebuffer(sim.width, sim.height, formatR, gl.NEAREST);
            };

            const correctRadius = (radius: number) => {
                const aspectRatio = canvas.width / Math.max(canvas.height, 1);
                return aspectRatio > 1 ? radius * aspectRatio : radius;
            };

            const splat = (x: number, y: number, dx: number, dy: number, color: FluidColor) => {
                if (!velocity || !dye) return;
                splatProgram.bind();
                gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
                gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / Math.max(canvas.height, 1));
                gl.uniform2f(splatProgram.uniforms.point, x, y);
                gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0);
                gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.splatRadius / 100));
                blit(velocity.write);
                velocity.swap();
                gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
                gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
                blit(dye.write);
                dye.swap();
            };

            const applyPointer = () => {
                if (!pointer.moved) return;
                pointer.moved = false;
                splat(pointer.texcoordX, pointer.texcoordY, pointer.deltaX * config.splatForce, pointer.deltaY * config.splatForce, pointer.color);
            };

            const step = (deltaTime: number) => {
                if (!velocity || !dye || !divergence || !curlTarget || !pressure) return;
                gl.disable(gl.BLEND);
                curlProgram.bind();
                gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
                gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
                blit(curlTarget);
                vorticityProgram.bind();
                gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
                gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
                gl.uniform1i(vorticityProgram.uniforms.uCurl, curlTarget.attach(1));
                gl.uniform1f(vorticityProgram.uniforms.curl, config.curl);
                gl.uniform1f(vorticityProgram.uniforms.dt, deltaTime);
                blit(velocity.write);
                velocity.swap();
                divergenceProgram.bind();
                gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
                gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
                blit(divergence);
                clearProgram.bind();
                gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
                gl.uniform1f(clearProgram.uniforms.value, config.pressure);
                blit(pressure.write);
                pressure.swap();
                pressureProgram.bind();
                gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
                gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
                for (let iteration = 0; iteration < config.pressureIterations; iteration += 1) {
                    gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
                    blit(pressure.write);
                    pressure.swap();
                }
                gradientProgram.bind();
                gl.uniform2f(gradientProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
                gl.uniform1i(gradientProgram.uniforms.uPressure, pressure.read.attach(0));
                gl.uniform1i(gradientProgram.uniforms.uVelocity, velocity.read.attach(1));
                blit(velocity.write);
                velocity.swap();
                advectionProgram.bind();
                gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
                if (!supportLinearFiltering) gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
                const velocityId = velocity.read.attach(0);
                gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
                gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
                gl.uniform1f(advectionProgram.uniforms.dt, deltaTime);
                gl.uniform1f(advectionProgram.uniforms.dissipation, config.velocityDissipation);
                blit(velocity.write);
                velocity.swap();
                if (!supportLinearFiltering) gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
                gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
                gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
                gl.uniform1f(advectionProgram.uniforms.dissipation, config.densityDissipation);
                blit(dye.write);
                dye.swap();
            };

            const render = () => {
                if (!dye) return;
                gl.disable(gl.BLEND);
                displayProgram.bind();
                if (SHADING) gl.uniform2f(displayProgram.uniforms.texelSize, 1 / gl.drawingBufferWidth, 1 / gl.drawingBufferHeight);
                gl.uniform1i(displayProgram.uniforms.uTexture, dye.read.attach(0));
                gl.uniform3f(displayProgram.uniforms.backColor, BACK_COLOR.r, BACK_COLOR.g, BACK_COLOR.b);
                gl.uniform1f(displayProgram.uniforms.transparentMode, TRANSPARENT ? 1 : 0);
                blit(null, true);
            };

            const clearDisplay = () => {
                clearFluidContextForReuse(gl, gl.drawingBufferWidth, gl.drawingBufferHeight);
            };

            const updateFrame = (time: number) => {
                if (!active || !pageVisible) {
                    running = false;
                    return;
                }
                const deltaTime = Math.min((time - lastUpdateTime) / 1000, 1 / 60);
                lastUpdateTime = time;
                if (resizeCanvas()) initFramebuffers();
                colorUpdateTimer += deltaTime * config.colorUpdateSpeed;
                if (colorUpdateTimer >= 1) {
                    colorUpdateTimer %= 1;
                    pointer.color = generateColor();
                }
                applyPointer();
                step(deltaTime);
                render();
                if (time - lastInteractionTime < config.idleTimeoutMs) {
                    animationFrameRef.current = requestAnimationFrame(updateFrame);
                } else {
                    running = false;
                    animationFrameRef.current = null;
                    clearDisplay();
                }
            };

            const requestRender = () => {
                lastInteractionTime = performance.now();
                if (running || !pageVisible) return;
                running = true;
                lastUpdateTime = lastInteractionTime;
                animationFrameRef.current = requestAnimationFrame(updateFrame);
            };

            const updatePointer = (clientX: number, clientY: number) => {
                const pixelRatio = Math.min(window.devicePixelRatio || 1, config.maxPixelRatio);
                const x = clientX * pixelRatio;
                const y = clientY * pixelRatio;
                const texcoordX = x / Math.max(canvas.width, 1);
                const texcoordY = 1 - y / Math.max(canvas.height, 1);
                if (!pointer.initialized) {
                    pointer.initialized = true;
                    pointer.texcoordX = texcoordX;
                    pointer.texcoordY = texcoordY;
                    pointer.prevTexcoordX = texcoordX;
                    pointer.prevTexcoordY = texcoordY;
                    requestRender();
                    return;
                }
                pointer.prevTexcoordX = pointer.texcoordX;
                pointer.prevTexcoordY = pointer.texcoordY;
                pointer.texcoordX = texcoordX;
                pointer.texcoordY = texcoordY;
                pointer.deltaX = pointer.texcoordX - pointer.prevTexcoordX;
                pointer.deltaY = pointer.texcoordY - pointer.prevTexcoordY;
                const aspectRatio = canvas.width / Math.max(canvas.height, 1);
                if (aspectRatio < 1) pointer.deltaX *= aspectRatio;
                if (aspectRatio > 1) pointer.deltaY /= aspectRatio;
                pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0;
                requestRender();
            };

            const handleMouseMove = (event: MouseEvent) => {
                updatePointer(event.clientX, event.clientY);
            };
            const handleMouseDown = (event: MouseEvent) => {
                if (event.button !== 0) return;
                updatePointer(event.clientX, event.clientY);
                const color = generateColor();
                splat(pointer.texcoordX, pointer.texcoordY, 10 * (Math.random() - 0.5), 30 * (Math.random() - 0.5), { r: color.r * 8, g: color.g * 8, b: color.b * 8 });
                requestRender();
            };
            const handleResize = () => requestRender();
            const handleVisibility = () => {
                pageVisible = document.visibilityState !== "hidden";
                if (!pageVisible) {
                    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
                    animationFrameRef.current = null;
                    running = false;
                    clearDisplay();
                }
            };

            resizeCanvas();
            initFramebuffers();
            clearDisplay();
            window.addEventListener("mousemove", handleMouseMove, { passive: true });
            window.addEventListener("mousedown", handleMouseDown, { passive: true });
            window.addEventListener("resize", handleResize, { passive: true });
            document.addEventListener("visibilitychange", handleVisibility);

            removeListeners = () => {
                window.removeEventListener("mousemove", handleMouseMove);
                window.removeEventListener("mousedown", handleMouseDown);
                window.removeEventListener("resize", handleResize);
                document.removeEventListener("visibilitychange", handleVisibility);
            };
        } catch (error) {
            console.warn("SplashCursor disabled because WebGL initialization failed", error);
            active = false;
            removeListeners?.();
            canvas.removeEventListener("webglcontextlost", handleContextLost);
            if (contextRecoveryTimer !== null) window.clearTimeout(contextRecoveryTimer);
            if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
            if (!clearFluidContextForReuse(gl, gl.drawingBufferWidth, gl.drawingBufferHeight)) canvas.style.visibility = "hidden";
            return;
        }

        return () => {
            active = false;
            removeListeners?.();
            canvas.removeEventListener("webglcontextlost", handleContextLost);
            if (contextRecoveryTimer !== null) window.clearTimeout(contextRecoveryTimer);
            if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
            clearFluidContextForReuse(gl, gl.drawingBufferWidth, gl.drawingBufferHeight);
        };
    }, [
        BACK_COLOR.b,
        BACK_COLOR.g,
        BACK_COLOR.r,
        CAPTURE_RESOLUTION,
        COLOR,
        COLOR_UPDATE_SPEED,
        CURL,
        DENSITY_DISSIPATION,
        DYE_RESOLUTION,
        IDLE_TIMEOUT_MS,
        MAX_PIXEL_RATIO,
        PRESSURE,
        PRESSURE_ITERATIONS,
        RAINBOW_MODE,
        SHADING,
        SIM_RESOLUTION,
        SPLAT_FORCE,
        SPLAT_RADIUS,
        TRANSPARENT,
        VELOCITY_DISSIPATION,
        canvasEpoch,
        enabled,
        environmentEnabled,
    ]);

    return (
        <div className={cn("splash-cursor-layer", className)} aria-hidden="true">
            <canvas key={canvasEpoch} ref={canvasRef} />
        </div>
    );
}

function createFluidContext(canvas: HTMLCanvasElement) {
    const params: WebGLContextAttributes = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
    const webgl2 = canvas.getContext("webgl2", params);
    const gl = webgl2 || canvas.getContext("webgl", params);
    if (!gl) return null;
    const isWebGL2 = Boolean(webgl2);
    let halfFloatTexType: number | null = null;
    let supportLinearFiltering = false;
    let formatRGBA: TextureFormat | null = null;
    let formatRG: TextureFormat | null = null;
    let formatR: TextureFormat | null = null;
    if (isWebGL2) {
        const gl2 = gl as WebGL2RenderingContext;
        gl2.getExtension("EXT_color_buffer_float");
        supportLinearFiltering = Boolean(gl2.getExtension("OES_texture_float_linear"));
        halfFloatTexType = gl2.HALF_FLOAT;
        formatRGBA = getSupportedFormat(gl2, gl2.RGBA16F, gl2.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl2, gl2.RG16F, gl2.RG, halfFloatTexType);
        formatR = getSupportedFormat(gl2, gl2.R16F, gl2.RED, halfFloatTexType);
    } else {
        const halfFloat = gl.getExtension("OES_texture_half_float") as { HALF_FLOAT_OES: number } | null;
        supportLinearFiltering = Boolean(gl.getExtension("OES_texture_half_float_linear"));
        halfFloatTexType = halfFloat?.HALF_FLOAT_OES ?? null;
        if (halfFloatTexType !== null) {
            formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
            formatRG = formatRGBA;
            formatR = formatRGBA;
        }
    }
    if (halfFloatTexType === null || !formatRGBA || !formatRG || !formatR) return null;
    return { gl, isWebGL2, halfFloatTexType, supportLinearFiltering, formatRGBA, formatRG, formatR };
}

function getSupportedFormat(gl: GL, internalFormat: number, format: number, type: number): TextureFormat | null {
    if (supportsRenderTextureFormat(gl, internalFormat, format, type)) return { internalFormat, format };
    if ("R16F" in gl && internalFormat === gl.R16F) return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
    if ("RG16F" in gl && internalFormat === gl.RG16F) return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
    return null;
}

function supportsRenderTextureFormat(gl: GL, internalFormat: number, format: number, type: number) {
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) return false;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const supported = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.deleteTexture(texture);
    gl.deleteFramebuffer(framebuffer);
    return supported;
}

function compileShader(gl: GL, type: number, source: string, keywords: string[] = []) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Unable to allocate SplashCursor shader");
    gl.shaderSource(shader, `${keywords.map((keyword) => `#define ${keyword}\n`).join("")}${source}`);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader) || "Unknown SplashCursor shader error";
        gl.deleteShader(shader);
        throw new Error(message);
    }
    return shader;
}

function createProgramBundle(gl: GL, vertexShader: WebGLShader, fragmentShader: WebGLShader): ProgramBundle {
    const program = gl.createProgram();
    if (!program) throw new Error("Unable to allocate SplashCursor program");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.bindAttribLocation(program, 0, "aPosition");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Unable to link SplashCursor program");
    const uniforms: UniformMap = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let index = 0; index < count; index += 1) {
        const info = gl.getActiveUniform(program, index);
        if (info) uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
    return { program, uniforms, bind: () => gl.useProgram(program) };
}

export default SplashCursor;
