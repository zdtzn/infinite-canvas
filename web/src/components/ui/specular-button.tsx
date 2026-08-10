import { useEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import "./specular-button.css";

type SpecularButtonSize = "sm" | "md" | "lg";

type SpecularButtonStyle = CSSProperties & Record<`--sb-${string}`, string | number>;

export interface SpecularButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
    children?: ReactNode;
    size?: SpecularButtonSize;
    radius?: number;
    tint?: string;
    tintOpacity?: number;
    blur?: number;
    textColor?: string;
    lineColor?: string;
    baseColor?: string;
    intensity?: number;
    shineSize?: number;
    shineFade?: number;
    thickness?: number;
    speed?: number;
    followMouse?: boolean;
    proximity?: number;
    autoAnimate?: boolean;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

export function SpecularButton({
    children = "Get Started",
    size = "lg",
    radius = 18,
    tint = "#ffffff",
    tintOpacity = 0,
    blur = 0,
    textColor = "#f5f5f5",
    lineColor = "#ffffff",
    baseColor = "#525252",
    intensity = 1,
    shineSize = 10,
    shineFade = 40,
    thickness = 1,
    speed = 0.35,
    followMouse = true,
    proximity = 250,
    autoAnimate = false,
    disabled = false,
    className,
    style,
    type = "button",
    ...buttonProps
}: SpecularButtonProps) {
    const buttonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const button = buttonRef.current;
        if (!button) return;

        button.style.setProperty("--sb-proximity", autoAnimate && !disabled ? "1" : "0");
        if (!followMouse || autoAnimate || disabled) return;

        const safeProximity = Math.max(proximity, 1);
        const handlePointerMove = (event: PointerEvent) => {
            const rect = button.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const distanceX = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
            const distanceY = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
            const distance = Math.hypot(distanceX, distanceY);
            const linearProximity = Math.max(0, 1 - distance / safeProximity);
            const easedProximity = linearProximity * linearProximity * (3 - 2 * linearProximity);
            const angle = (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) / Math.PI + 90;

            button.style.setProperty("--sb-angle", `${angle.toFixed(2)}deg`);
            button.style.setProperty("--sb-proximity", easedProximity.toFixed(3));
        };

        const clearShine = () => button.style.setProperty("--sb-proximity", "0");

        window.addEventListener("pointermove", handlePointerMove, { passive: true });
        window.addEventListener("blur", clearShine);

        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("blur", clearShine);
        };
    }, [autoAnimate, disabled, followMouse, proximity]);

    const safeShineSize = clamp(shineSize, 1, 80);
    const safeShineFade = clamp(Math.max(shineFade, safeShineSize + 1), safeShineSize + 1, 89);
    const cycleSeconds = clamp((Math.PI * 2) / Math.max(speed, 0.05), 3, 60);
    const specularStyle: SpecularButtonStyle = {
        "--sb-radius": `${Math.max(radius, 0)}px`,
        "--sb-tint": tint,
        "--sb-tint-opacity": clamp(tintOpacity, 0, 1),
        "--sb-blur": `${Math.max(blur, 0)}px`,
        "--sb-text-color": textColor,
        "--sb-line-color": lineColor,
        "--sb-base-color": baseColor,
        "--sb-intensity": Math.max(intensity, 0),
        "--sb-shine-size": `${safeShineSize}deg`,
        "--sb-shine-fade": `${safeShineFade}deg`,
        "--sb-thickness": `${Math.max(thickness, 0.5)}px`,
        "--sb-cycle": `${cycleSeconds}s`,
        ...style,
    };

    return (
        <button ref={buttonRef} type={type} disabled={disabled} data-auto-animate={autoAnimate && !disabled ? "true" : "false"} className={cn("specular-button", `specular-button--${size}`, className)} style={specularStyle} {...buttonProps}>
            <span className="specular-button__shine" aria-hidden="true" />
            <span className="specular-button__label">{children}</span>
        </button>
    );
}

export default SpecularButton;
