import { type ReactNode, useEffect, useState } from "react";

export type RealmWelcomeMessage = {
    eyebrow: string;
    title: string;
    description: string[];
};

export const LOGIN_TRANSITION_MS = 720;

export const realmWelcomeMessages: RealmWelcomeMessage[] = [
    {
        eyebrow: "踏入修炼之地",
        title: "欢迎道友",
        description: ["寻找属于自己的创作机缘。", "一念落笔，万象由此而生。"],
    },
    {
        eyebrow: "天地画卷已开启",
        title: "欢迎归来，道友。",
        description: ["此方天地仍在等候。", "继续你的下一次执笔。"],
    },
    {
        eyebrow: "此方天地皆可入画",
        title: "道友请入座。",
        description: ["灵感不必循规蹈矩。", "心中所见，皆可成为创作之境。"],
    },
    {
        eyebrow: "创作者归来",
        title: "新的画卷正在等待。",
        description: ["天地法则已静候于此。", "请以想象，重新定义万象。"],
    },
    {
        eyebrow: "欢迎进入无限画界",
        title: "万象皆可绘。",
        description: ["天地皆可卷。", "每一次创作，都是新的机缘。"],
    },
];

export const loginTransitionMessages = ["正在连接天地法则……", "正在开启创作空间……", "画界已开启。"];

function stableIndex(seed: string, length: number) {
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
    return length ? hash % length : 0;
}

export function selectRealmMessage(seed: string) {
    return realmWelcomeMessages[stableIndex(seed, realmWelcomeMessages.length)];
}

export function selectLoginTransitionMessage(seed: string) {
    return loginTransitionMessages[stableIndex(seed, loginTransitionMessages.length)];
}

export function LoginRealmBackground({ children }: { children: ReactNode }) {
    return (
        <main className="login-realm relative min-h-dvh overflow-x-hidden overflow-y-auto bg-[#090b10] text-[#edede6]">
            <img
                src="/images/ref/misty-dawn.webp"
                alt=""
                aria-hidden="true"
                width={1280}
                height={720}
                loading="eager"
                fetchPriority="high"
                className="login-realm-background-image absolute inset-0 h-full min-h-dvh w-full object-cover"
            />
            <div className="login-realm-background-shade absolute inset-0" aria-hidden="true" />
            <div className="login-realm-rule-lines absolute inset-0" aria-hidden="true" />
            <div className="relative z-10 min-h-dvh">{children}</div>
        </main>
    );
}

export function RealmWelcomeText({ compact = false, seed = "infinite-canvas" }: { compact?: boolean; seed?: string }) {
    const [index, setIndex] = useState(() => stableIndex(`${seed}:${new Date().toISOString().slice(0, 13)}`, realmWelcomeMessages.length));

    useEffect(() => {
        const timer = window.setInterval(() => setIndex((current) => (current + 1) % realmWelcomeMessages.length), 6800);
        return () => window.clearInterval(timer);
    }, []);

    const message = realmWelcomeMessages[index];
    return (
        <div className={compact ? "min-h-[132px]" : "min-h-[210px]"} aria-live="polite" aria-atomic="true">
            <div key={index} className="login-realm-welcome-copy">
                <p className="mb-3 text-xs font-medium text-[#c9a86a]">{message.eyebrow}</p>
                <h2 className={`font-brush text-balance leading-tight text-[#f7f4ea] ${compact ? "text-3xl" : "text-5xl"}`}>{message.title}</h2>
                <div className={`mt-5 text-[#c9c4b9] ${compact ? "text-sm leading-6" : "text-base leading-7"}`}>
                    {message.description.map((line) => (
                        <p key={line}>{line}</p>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function LoginTransition({ message }: { message: string }) {
    return (
        <div className="login-realm-transition fixed inset-0 z-[100] grid place-items-center bg-[#090b10] px-6 text-center text-[#edede6]" role="status" aria-live="assertive">
            <div className="login-realm-transition-content flex flex-col items-center">
                <span
                    className="mb-6 size-12 bg-[#c9a86a]"
                    style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }}
                    aria-hidden="true"
                />
                <p className="font-brush text-3xl text-[#f7f4ea]">{message}</p>
                <span className="mt-6 h-px w-28 bg-[linear-gradient(90deg,transparent,rgb(201_168_106/0.7),transparent)]" aria-hidden="true" />
            </div>
        </div>
    );
}
