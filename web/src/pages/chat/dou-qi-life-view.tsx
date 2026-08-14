import { App, Button, Card, Collapse, Divider, Input, InputNumber, List, Segmented, Select, Skeleton, Space, Tag, Tooltip } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { Archive, Backpack, BookOpen, ChevronRight, CirclePlus, Clock3, Compass, Dice5, Eye, Flame, Heart, MessageCircle, Move, Save, ScrollText, Send, Shield, Sparkles, Swords, Trash2, UserRound, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { createDouQiLifeSession, deleteDouQiLifeSave, deleteDouQiLifeSession, fetchDouQiLifeSaves, fetchDouQiLifeSession, fetchDouQiLifeSessions, restoreDouQiLifeSave, saveDouQiLifeSession, sendDouQiLifeTurn, type DouQiLifeCharacterInput, type DouQiLifeDetail, type DouQiLifeMessage, type DouQiLifeSave, type DouQiLifeSession, type DouQiLifeState, type DouQiLifeSuggestion } from "@/services/dou-qi-life-api";
import { useUserStore } from "@/stores/use-user-store";

type Props = { onExit: () => void };
type Phase = "transition" | "loading" | "welcome" | "create" | "world";

const emptyCharacter: DouQiLifeCharacterInput = {
    name: "",
    gender: "不愿说明",
    age: 18,
    birthplace: "",
    race: "人族",
    familyBackground: "",
    personality: "",
    appearance: "",
    lifeGoal: "",
    talent: "",
};

const randomCharacters: DouQiLifeCharacterInput[] = [
    { name: "沈砚", gender: "男", age: 17, birthplace: "青山镇", race: "人族", familyBackground: "普通药农之家，家中靠山吃山", personality: "谨慎，善于观察", appearance: "眉眼清秀，常着旧青衣", lifeGoal: "查清父亲失踪的真相", talent: "对火属性斗气略有感应" },
    { name: "叶清禾", gender: "女", age: 16, birthplace: "漠城边缘", race: "人族", familyBackground: "商旅世家，自幼随车队行走诸城", personality: "果断，重诺，心思细密", appearance: "黑发束起，眼神明亮", lifeGoal: "走遍大陆，找到一处真正的归处", talent: "记忆力出众，感知敏锐" },
    { name: "顾长风", gender: "男", age: 19, birthplace: "乌坦城外", race: "人族", familyBackground: "没落小族，家中只剩一部残缺功法", personality: "沉默，执拗，不轻易认输", appearance: "身形修长，掌心有旧伤", lifeGoal: "让家族重新拥有立足之地", talent: "经脉坚韧，修炼速度稳定" },
];

export default function DouQiLifeView({ onExit }: Props) {
    const { message, modal } = App.useApp();
    const userId = useUserStore((state) => state.user?.id || "");
    const [phase, setPhase] = useState<Phase>("transition");
    const [sessions, setSessions] = useState<DouQiLifeSession[]>([]);
    const [activeSession, setActiveSession] = useState<DouQiLifeSession | null>(null);
    const [messages, setMessages] = useState<DouQiLifeMessage[]>([]);
    const [saves, setSaves] = useState<DouQiLifeSave[]>([]);
    const [character, setCharacter] = useState<DouQiLifeCharacterInput>(emptyCharacter);
    const [draft, setDraft] = useState("");
    const [suggestions, setSuggestions] = useState<DouQiLifeSuggestion[]>([]);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const mountedRef = useRef(false);
    const loadTokenRef = useRef(0);
    const turnTokenRef = useRef(0);
    const turnAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        mountedRef.current = true;
        const token = ++loadTokenRef.current;
        setPhase("transition");
        const transitionTimer = window.setTimeout(() => {
            if (!isCurrentLoad(token)) return;
            setPhase("loading");
            void Promise.all([fetchDouQiLifeSessions(userId), fetchDouQiLifeSaves(undefined, userId)])
                .then(async ([result, saveResult]) => {
                    if (!isCurrentLoad(token)) return;
                    setSessions(result.items);
                    if (!result.items.length) {
                        setActiveSession(null);
                        setMessages([]);
                        setSaves(saveResult.items);
                        setPhase("welcome");
                        return;
                    }
                    await loadSession(result.items[0].id);
                })
                .catch((error) => isCurrentLoad(token) && message.error(error instanceof Error ? error.message : "斗气人生加载失败"));
        }, 650);
        return () => {
            window.clearTimeout(transitionTimer);
            mountedRef.current = false;
            loadTokenRef.current += 1;
            abortTurn();
        };
    }, [message, userId]);

    function isCurrentLoad(token: number) {
        return mountedRef.current && loadTokenRef.current === token;
    }

    function isCurrentTurn(token: number) {
        return mountedRef.current && turnTokenRef.current === token;
    }

    function abortTurn() {
        turnTokenRef.current += 1;
        turnAbortRef.current?.abort();
        turnAbortRef.current = null;
        if (mountedRef.current) setSending(false);
    }

    async function loadSession(id: string) {
        const token = ++loadTokenRef.current;
        setLoading(true);
        setPhase("loading");
        try {
            const [detail, saveResult] = await Promise.all([fetchDouQiLifeSession(id, userId), fetchDouQiLifeSaves(id, userId)]);
            if (!isCurrentLoad(token)) return;
            applyDetail(detail);
            setSaves(saveResult.items);
            setPhase("world");
        } catch (error) {
            if (isCurrentLoad(token)) message.error(error instanceof Error ? error.message : "人生读取失败");
        } finally {
            if (isCurrentLoad(token)) setLoading(false);
        }
    }

    function applyDetail(detail: DouQiLifeDetail) {
        setActiveSession(detail.session);
        setMessages(detail.messages);
        const latest = [...detail.messages].reverse().find((item) => item.role === "world" && item.status === "completed");
        setSuggestions(latest?.metadata?.suggestions || []);
    }

    function randomizeCharacter() {
        const next = randomCharacters[Math.floor(Math.random() * randomCharacters.length)];
        setCharacter({ ...next });
    }

    async function handleCreate() {
        if (loading) return;
        setLoading(true);
        try {
            const result = await createDouQiLifeSession(character, userId);
            setSessions((current) => [result.session, ...current]);
            const [detail, saveResult] = await Promise.all([
                fetchDouQiLifeSession(result.session.id, userId),
                fetchDouQiLifeSaves(result.session.id, userId),
            ]);
            applyDetail(detail);
            setSaves(saveResult.items);
            setCharacter(emptyCharacter);
            setPhase("world");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "角色创建失败");
        } finally {
            setLoading(false);
        }
    }

    function startNewLife() {
        setCharacter(emptyCharacter);
        setPhase("create");
    }

    function handleNewLife() {
        if (sending) {
            modal.confirm({
                title: "世界回应仍在推演",
                content: "开始新人生会停止当前回应，已经收到的内容会保留。是否继续？",
                okText: "停止并新建",
                cancelText: "继续等待",
                onOk: () => {
                    abortTurn();
                    startNewLife();
                },
            });
            return;
        }
        startNewLife();
    }

    function handleRandomLife() {
        randomizeCharacter();
        setPhase("create");
    }

    async function handleSend(action = draft.trim()) {
        if (!activeSession || !action || sending) return;
        setSending(true);
        setDraft("");
        const controller = new AbortController();
        const token = ++turnTokenRef.current;
        turnAbortRef.current = controller;
        let worldMessageId = "";
        try {
            await sendDouQiLifeTurn(activeSession.id, action, {
                expectedUserId: userId,
                signal: controller.signal,
                onStarted: (event) => {
                    if (!isCurrentTurn(token)) return;
                    worldMessageId = event.worldMessage.id;
                    setActiveSession(event.session);
                    setMessages((current) => [...current, event.playerMessage, event.worldMessage]);
                },
                onDelta: ({ messageId, delta }) => {
                    if (!isCurrentTurn(token)) return;
                    setMessages((current) => current.map((item) => (item.id === messageId ? { ...item, content: item.content + delta, status: "streaming" } : item)));
                },
                onDone: (event) => {
                    if (!isCurrentTurn(token)) return;
                    setActiveSession(event.session);
                    setSuggestions(event.suggestions || []);
                    setMessages((current) => current.map((item) => (item.id === event.worldMessage.id ? event.worldMessage : item)));
                    setSessions((current) => [event.session, ...current.filter((item) => item.id !== event.session.id)]);
                    void fetchDouQiLifeSaves(event.session.id, userId).then((result) => setSaves(result.items)).catch(() => undefined);
                    if (event.notice) message.info(event.notice);
                },
                onError: ({ message: errorMessage }) => {
                    if (!isCurrentTurn(token)) return;
                    setMessages((current) => current.map((item) => (item.id === worldMessageId ? { ...item, status: "failed", error: errorMessage } : item)));
                    message.error(errorMessage);
                },
            });
        } catch (error) {
            if (isCurrentTurn(token) && !isAbortError(error)) message.error(error instanceof Error ? error.message : "世界回应暂未完成");
        } finally {
            if (isCurrentTurn(token)) {
                turnAbortRef.current = null;
                setSending(false);
            }
        }
    }

    async function handleSave() {
        if (!activeSession || sending) return;
        try {
            const title = `${activeSession.state.player.name} · ${activeSession.state.world.location}`;
            const result = await saveDouQiLifeSession({ sessionId: activeSession.id, title }, userId);
            setSaves((current) => [result.save, ...current]);
            message.success("这一刻已留存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "存档失败");
        }
    }

    async function restoreSavedLife(save: DouQiLifeSave) {
        try {
            const result = await restoreDouQiLifeSave(save.id, userId);
            setSessions((current) => [result.session, ...current]);
            await loadSession(result.session.id);
            message.success("已从存档续行");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "存档读取失败");
        }
    }

    function handleRestore(save: DouQiLifeSave) {
        if (sending) {
            modal.confirm({
                title: "世界回应仍在推演",
                content: "读取存档会停止当前回应，已经收到的内容会保留。是否继续？",
                okText: "停止并读取",
                cancelText: "继续等待",
                onOk: () => {
                    abortTurn();
                    void restoreSavedLife(save);
                },
            });
            return;
        }
        void restoreSavedLife(save);
    }

    async function deleteLifeSession(id: string) {
        try {
            await deleteDouQiLifeSession(id, userId);
            const next = sessions.filter((item) => item.id !== id);
            setSessions(next);
            if (activeSession?.id === id) {
                setActiveSession(null);
                setMessages([]);
                setPhase(next.length ? "loading" : "welcome");
                if (next[0]) await loadSession(next[0].id);
                else setSaves((await fetchDouQiLifeSaves(undefined, userId)).items);
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "人生删除失败");
        }
    }

    function handleDeleteSession(id: string) {
        if (sending && activeSession?.id === id) {
            modal.confirm({
                title: "世界回应仍在推演",
                content: "删除这段人生会停止当前回应，已经收到的内容会保留为失败记录。是否继续？",
                okText: "停止并删除",
                cancelText: "继续等待",
                onOk: () => {
                    abortTurn();
                    void deleteLifeSession(id);
                },
            });
            return;
        }
        void deleteLifeSession(id);
    }

    async function handleDeleteSave(id: string) {
        try {
            await deleteDouQiLifeSave(id, userId);
            setSaves((current) => current.filter((item) => item.id !== id));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "存档删除失败");
        }
    }

    function handleSelectSession(id: string) {
        if (sending && activeSession?.id !== id) {
            modal.confirm({
                title: "世界回应仍在推演",
                content: "切换人生会停止当前回应，已经收到的内容会保留。是否继续？",
                okText: "停止并切换",
                cancelText: "继续等待",
                onOk: () => {
                    abortTurn();
                    void loadSession(id);
                },
            });
            return;
        }
        void loadSession(id);
    }

    function handleExit() {
        if (sending) {
            modal.confirm({
                title: "世界回应仍在推演",
                content: "离开斗气人生会停止当前回应，已经收到的内容会保留。是否离开？",
                okText: "停止并离开",
                cancelText: "继续等待",
                onOk: () => {
                    abortTurn();
                    onExit();
                },
            });
            return;
        }
        onExit();
    }

    const latestNarrative = useMemo(() => [...messages].reverse().find((item) => item.role === "world" && item.content)?.content || activeSession?.lastNarrative || "天地初开，尚未有新的因果落下。", [activeSession?.lastNarrative, messages]);

    return (
        <div className="h-full overflow-hidden bg-[#f7f5ef] text-stone-900 dark:bg-[#11100e] dark:text-[#f5efe3]">
            <div className="mx-auto flex h-full max-w-[1480px] flex-col px-4 py-4 max-lg:px-3">
                <div className="mb-3 flex shrink-0 items-center justify-between gap-3 rounded-xl border border-stone-200/80 bg-white/75 px-4 py-3 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-amber-300/60 bg-amber-50 text-amber-700 dark:border-amber-200/20 dark:bg-amber-300/10 dark:text-amber-200"><Flame className="size-4" /></div>
                        <div className="min-w-0"><div className="text-base font-semibold tracking-[0.12em]">问道台</div><div className="truncate text-xs text-stone-500 dark:text-stone-400">斗气人生 · 你的选择只属于你</div></div>
                    </div>
                    <Segmented options={[{ label: "普通问道", value: "chat" }, { label: "斗气人生", value: "douqi" }]} value="douqi" onChange={(value) => value === "chat" && handleExit()} />
                </div>

                {phase === "transition" ? <RealmTransition /> : null}
                {phase === "loading" ? <div className="grid min-h-0 flex-1 place-items-center"><Skeleton active paragraph={{ rows: 6 }} className="w-full max-w-2xl" /></div> : null}
                {phase === "welcome" ? <Welcome onStart={() => setPhase("create")} onLater={onExit} onNew={handleRandomLife} onRestore={handleRestore} saves={saves} /> : null}
                {phase === "create" ? <CharacterCreation value={character} loading={loading} onChange={setCharacter} onRandom={randomizeCharacter} onCancel={() => setPhase(sessions.length ? "world" : "welcome")} onSubmit={handleCreate} /> : null}
                {phase === "world" && activeSession ? (
                    <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)_280px] gap-3 max-xl:grid-cols-[220px_minmax(0,1fr)] max-lg:grid-cols-1">
                        <LifeArchives sessions={sessions} activeId={activeSession.id} saves={saves} onSelect={handleSelectSession} onNew={handleNewLife} onRestore={handleRestore} onDelete={handleDeleteSession} onDeleteSave={(id) => void handleDeleteSave(id)} />
                        <main className="flex min-h-0 min-w-0 flex-col rounded-xl border border-stone-200/80 bg-white/55 p-4 dark:border-white/10 dark:bg-black/10">
                            <div className="mb-3 flex shrink-0 items-start justify-between gap-3 border-b border-stone-200/70 pb-3 dark:border-white/10">
                                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Compass className="size-4 text-amber-600" /><span className="truncate font-medium">{activeSession.state.world.location}</span><Tag color="gold">{activeSession.state.player.realm}</Tag></div><div className="mt-1 text-xs text-stone-500 dark:text-stone-400">第 {activeSession.state.world.year} 年 · {activeSession.state.world.season} · {activeSession.state.world.month} 月 {activeSession.state.world.day} 日 · {activeSession.state.world.period}</div></div>
                                <Space><Tooltip title="保存当前人生"><Button type="text" icon={<Save className="size-4" />} onClick={() => void handleSave()} /></Tooltip><Button type="text" icon={<CirclePlus className="size-4" />} onClick={() => void handleNewLife()}>新人生</Button></Space>
                            </div>
                            <div className="min-h-0 flex-1 overflow-y-auto pr-1">{messages.length ? <div className="space-y-3">{messages.map((item) => <LifeMessage key={item.id} item={item} />)}</div> : <div className="rounded-lg border border-amber-200/70 bg-amber-50/45 p-4 text-sm leading-7 dark:border-amber-200/10 dark:bg-amber-300/[0.06]">{latestNarrative}</div>}</div>
                            <ActionDock state={activeSession.state} suggestions={suggestions} sending={sending} draft={draft} onDraftChange={setDraft} onSend={(action) => void handleSend(action)} />
                        </main>
                        <LifeStatus session={activeSession} />
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function RealmTransition() {
    return <div className="grid min-h-0 flex-1 place-items-center"><div className="animate-[dou-qi-life-fade-in_650ms_ease-out] text-center"><div className="mx-auto grid size-14 place-items-center rounded-full border border-amber-300/60 bg-amber-50/70 text-amber-700 dark:border-amber-200/20 dark:bg-amber-300/10 dark:text-amber-200"><WandSparkles className="size-6" /></div><div className="mt-5 text-lg font-medium tracking-[0.16em]">天地已开，道友请入局。</div><div className="mt-2 text-sm text-stone-500 dark:text-stone-400">正在为你铺开一方尚未写定的天地</div></div></div>;
}

function Welcome({ onStart, onLater, onNew, onRestore, saves }: { onStart: () => void; onLater: () => void; onNew: () => void; onRestore: (save: DouQiLifeSave) => void; saves: DouQiLifeSave[] }) {
    return <div className="grid min-h-0 flex-1 place-items-center"><div className="w-full max-w-xl rounded-2xl border border-amber-200/70 bg-white/70 p-8 text-center shadow-sm dark:border-amber-200/10 dark:bg-white/[0.04]"><div className="mx-auto grid size-14 place-items-center rounded-full border border-amber-300/60 bg-amber-50 text-amber-700 dark:border-amber-200/20 dark:bg-amber-300/10 dark:text-amber-200"><Sparkles className="size-6" /></div><h1 className="mt-5 text-2xl font-semibold tracking-[0.12em]">欢迎来到斗气大陆</h1><div className="mt-3 space-y-1 text-sm leading-7 text-stone-500 dark:text-stone-400"><p>这里没有既定的主角。</p><p>你的一念一行，都会成为自己的因果。</p></div><Space className="mt-6"><Button type="primary" onClick={onStart}>开始我的人生</Button><Button onClick={onLater}>以后再说</Button><Button type="text" onClick={onNew}>随机入世</Button></Space>{saves.length ? <div className="mt-8 text-left"><div className="mb-2 text-xs text-stone-500">已有存档</div><List size="small" dataSource={saves.filter((save) => save.kind === "manual")} renderItem={(save) => <List.Item actions={[<Button key="restore" type="link" onClick={() => onRestore(save)}>续行</Button>]}>{save.title}</List.Item>} /></div> : null}</div></div>;
}

function CharacterCreation({ value, loading, onChange, onRandom, onCancel, onSubmit }: { value: DouQiLifeCharacterInput; loading: boolean; onChange: (value: DouQiLifeCharacterInput) => void; onRandom: () => void; onCancel: () => void; onSubmit: () => void }) {
    const [step, setStep] = useState(0);
    const steps: Array<{ key: keyof DouQiLifeCharacterInput; label: string; placeholder: string; kind?: "gender" | "age" }> = [
        { key: "name", label: "姓名", placeholder: "为自己取一个名字" },
        { key: "gender", label: "性别", placeholder: "选择你的性别", kind: "gender" },
        { key: "age", label: "年龄", placeholder: "你的年龄", kind: "age" },
        { key: "birthplace", label: "出生地", placeholder: "例如：青山镇" },
        { key: "race", label: "种族", placeholder: "例如：人族" },
        { key: "familyBackground", label: "家庭背景", placeholder: "你从怎样的家庭来" },
        { key: "personality", label: "性格", placeholder: "你如何面对世界" },
        { key: "appearance", label: "外貌", placeholder: "让世界初见你的样子" },
        { key: "lifeGoal", label: "人生目标", placeholder: "你想追寻什么" },
        { key: "talent", label: "天赋", placeholder: "尚未觉醒也可以" },
    ];
    const current = steps[step];
    const set = (key: keyof DouQiLifeCharacterInput, next: string | number) => onChange({ ...value, [key]: next });
    const currentValue = value[current.key];
    const isLast = step === steps.length - 1;
    const next = () => isLast ? onSubmit() : setStep((currentStep) => currentStep + 1);
    return <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-2xl"><div className="mb-4 flex items-center justify-between"><div><div className="text-xl font-semibold tracking-[0.12em]">先定下你的来处</div><div className="mt-1 text-sm text-stone-500">第 {step + 1} / {steps.length} 步 · 角色从一个选择开始。</div></div><Button icon={<Dice5 className="size-4" />} onClick={onRandom}>随机生成</Button></div><div className="mb-4 flex gap-1">{steps.map((item, index) => <span key={item.key} className={cn("h-1 flex-1 rounded-full", index <= step ? "bg-amber-500" : "bg-stone-200 dark:bg-white/10")} />)}</div><Card className="border-stone-200/80 dark:border-white/10"><div className="min-h-[260px] py-8"><div className="text-sm text-stone-500">{current.label}</div>{current.kind === "gender" ? <Select className="mt-3 w-full" size="large" value={value.gender} options={["男", "女", "不愿说明"].map((item) => ({ value: item, label: item }))} onChange={(nextValue) => set("gender", nextValue)} /> : current.kind === "age" ? <InputNumber className="mt-3 w-full" size="large" min={1} max={999} value={value.age} onChange={(nextValue) => onChange({ ...value, age: Number(nextValue || 18) })} /> : <Input value={String(currentValue || "")} size="large" className="mt-3" placeholder={current.placeholder} onChange={(event) => set(current.key, event.target.value)} onPressEnter={(event) => { event.preventDefault(); next(); }} />}<div className="mt-3 text-xs text-stone-400">可以留空，天地会为你保留一条合理的来路。</div></div><Divider /><div className="flex justify-between gap-2"><Button onClick={step ? () => setStep((currentStep) => currentStep - 1) : onCancel}>上一步</Button><Space><Button onClick={onRandom}>随机生成</Button><Button type="primary" loading={loading} onClick={next}>{isLast ? "进入斗气大陆" : "下一步"}</Button></Space></div></Card></div></div>;
}

function LifeArchives({ sessions, activeId, saves, onSelect, onNew, onRestore, onDelete, onDeleteSave }: { sessions: DouQiLifeSession[]; activeId: string; saves: DouQiLifeSave[]; onSelect: (id: string) => void; onNew: () => void; onRestore: (save: DouQiLifeSave) => void; onDelete: (id: string) => void; onDeleteSave: (id: string) => void }) {
    const manualSaves = saves.filter((save) => save.kind === "manual");
    const autoSave = saves.find((save) => save.kind === "auto");
    return <aside className="min-h-0 overflow-y-auto rounded-xl border border-stone-200/80 bg-white/45 p-3 dark:border-white/10 dark:bg-white/[0.03]"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-medium"><Archive className="size-4 text-amber-600" />人生档案</div><Tooltip title="新建人生"><Button type="text" size="small" icon={<CirclePlus className="size-4" />} onClick={onNew} /></Tooltip></div><div className="space-y-1">{sessions.map((session) => <div key={session.id} className={cn("group flex items-center gap-2 rounded-lg px-2 py-2 text-sm", activeId === session.id ? "bg-amber-100/70 dark:bg-amber-300/10" : "hover:bg-black/[0.04] dark:hover:bg-white/[0.05]")}><button className="min-w-0 flex-1 truncate text-left" onClick={() => onSelect(session.id)}><div className="truncate">{session.title}</div><div className="mt-0.5 truncate text-xs text-stone-500">{session.state.world.location}</div></button><Button type="text" size="small" className="!px-1 opacity-0 group-hover:opacity-100" icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(session.id)} /></div>)}</div><Divider className="my-3" /><div className="mb-2 flex items-center gap-2 text-xs text-stone-500"><ScrollText className="size-3.5" />存档</div>{autoSave ? <div className="mb-2 flex items-center gap-1 text-xs text-stone-500"><button className="min-w-0 flex-1 truncate text-left hover:text-amber-700" onClick={() => onRestore(autoSave)}>自动留痕 · {autoSave.title.replace(/^自动留痕 · /, "")}</button><Tag bordered={false} color="default">自动</Tag></div> : null}{manualSaves.length ? <div className="space-y-1">{manualSaves.map((save) => <div key={save.id} className="flex items-center gap-1 text-xs"><button className="min-w-0 flex-1 truncate text-left hover:text-amber-700" onClick={() => onRestore(save)}>{save.title}</button><Button type="text" size="small" className="!px-1" icon={<Trash2 className="size-3" />} onClick={() => onDeleteSave(save.id)} /></div>)}</div> : <div className="text-xs text-stone-400">尚无手动存档</div>}</aside>;
}

function LifeStatus({ session }: { session: DouQiLifeSession }) {
    const { player, inventory, battle } = session.state;
    const itemGroups = groupItems(inventory.items);
    const panels = [
        { key: "character", label: "角色详情", icon: <UserRound className="size-4" />, children: <div className="space-y-2 text-xs leading-5"><div><span className="text-stone-500">出身：</span>{player.familyBackground}</div><div><span className="text-stone-500">性格：</span>{player.personality}</div><div><span className="text-stone-500">外貌：</span>{player.appearance}</div><div><span className="text-stone-500">目标：</span>{player.lifeGoal}</div><div><span className="text-stone-500">天赋：</span>{player.talent}</div></div> },
        { key: "inventory", label: `背包 · ${inventory.items.length}`, icon: <Backpack className="size-4" />, children: <div className="space-y-3 text-xs"><div className="flex items-center justify-between"><span className="text-stone-500">灵石</span><span>{inventory.gold}</span></div>{Object.entries(itemGroups).map(([category, items]) => <div key={category}><div className="mb-1 text-stone-500">{category}</div>{items.map((item) => <div key={item.id} className="flex justify-between gap-2 py-1"><span className="truncate" title={item.description}>{item.name}</span><span className="shrink-0">×{item.quantity}</span></div>)}</div>)}{!inventory.items.length ? <div className="text-stone-400">背包尚空</div> : null}</div> },
        { key: "techniques", label: `功法与斗技 · ${session.state.techniques.length}`, icon: <BookOpen className="size-4" />, children: <div className="space-y-3 text-xs"><TechniqueGroup title="功法" items={session.state.techniques.filter((technique) => technique.kind === "功法")} /><TechniqueGroup title="斗技" items={session.state.techniques.filter((technique) => technique.kind === "斗技")} />{!session.state.techniques.length ? <div className="text-stone-400">尚未获得功法或斗技</div> : null}</div> },
        { key: "npcs", label: `NPC 关系 · ${session.state.npcs.length}`, icon: <UserRound className="size-4" />, children: <div className="space-y-2 text-xs">{session.state.npcs.map((npc) => <div key={npc.id} className="border-b border-stone-200/60 pb-2 last:border-0 dark:border-white/10"><div className="flex items-center justify-between gap-2 font-medium"><span>{npc.name}</span><Tag bordered={false}>{npc.relationship > 0 ? `关系 +${npc.relationship}` : `关系 ${npc.relationship}`}</Tag></div><div className="mt-1 text-stone-500">{npc.identity} · {npc.realm} · {npc.faction}</div><div className="mt-1 leading-5">印象：{npc.impression}</div><div className="mt-1 text-stone-400">最近见于：{npc.lastSeenAt}</div></div>)}{!session.state.npcs.length ? <div className="text-stone-400">尚未遇见重要人物</div> : null}</div> },
        { key: "events", label: `世界事件 · ${session.state.memory.worldEvents.length}`, icon: <Eye className="size-4" />, children: <div className="space-y-2 text-xs">{session.state.memory.worldEvents.map((event) => <div key={event.id} className="border-b border-stone-200/60 pb-2 last:border-0 dark:border-white/10"><div className="flex items-center justify-between gap-2 font-medium"><span>{event.title}</span><Tag bordered={false}>{event.status}</Tag></div><div className="mt-1 text-stone-500">{event.location} · {event.occurredAt}</div><div className="mt-1 leading-5">{event.description}</div></div>)}{!session.state.memory.worldEvents.length ? <div className="text-stone-400">天地尚未显露事件</div> : null}</div> },
    ];
    return <aside className="min-h-0 overflow-y-auto rounded-xl border border-stone-200/80 bg-white/45 p-4 dark:border-white/10 dark:bg-white/[0.03] max-xl:col-span-2 max-xl:col-start-1 max-xl:row-start-2 max-lg:col-span-1 max-lg:col-start-auto max-lg:row-start-auto"><div className="flex items-center gap-2"><Shield className="size-4 text-amber-600" /><span className="font-medium">{player.name}</span></div><div className="mt-1 text-xs text-stone-500">{player.gender} · {player.age} 岁 · {player.race}</div><div className="mt-1 text-sm font-medium text-amber-700 dark:text-amber-200">{player.realm} · {player.qiStage} 段</div><Divider className="my-3" /><StatusBar icon={<Flame className="size-3.5" />} label="斗气" value={player.qi} max={player.qiMax} /><StatusBar icon={<Heart className="size-3.5" />} label="生命" value={player.life} max={player.lifeMax} /><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.04]"><div className="text-stone-500">心境</div><div className="mt-1 font-medium">{player.mood}</div></div><div className="rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.04]"><div className="text-stone-500">状态</div><div className="mt-1 font-medium">{player.condition}</div></div></div>{battle.active ? <div className="mt-4 rounded-lg border border-red-200/70 bg-red-50/50 p-3 text-xs dark:border-red-300/10 dark:bg-red-300/[0.06]"><div className="flex items-center gap-2 font-medium text-red-700 dark:text-red-200"><Swords className="size-3.5" />{battle.enemyName} · {battle.enemyRealm}</div><div className="mt-1">敌方生命 {battle.enemyLife} / {battle.enemyLifeMax}</div><div className="mt-1 text-stone-500">{battle.status}</div></div> : null}<Collapse className="mt-3" ghost items={panels} /></aside>;
}

function StatusBar({ icon, label, value, max }: { icon: React.ReactNode; label: string; value: number; max: number }) {
    const ratio = Math.max(0, Math.min(1, max ? value / max : 0));
    return <div className="mt-3"><div className="flex items-center justify-between text-xs"><span className="flex items-center gap-1.5 text-stone-500">{icon}{label}</span><span>{value} / {max}</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"><div className="h-full rounded-full bg-amber-500 transition-[width] duration-300" style={{ width: `${ratio * 100}%` }} /></div></div>;
}

function ActionDock({ state, suggestions, sending, draft, onDraftChange, onSend }: { state: DouQiLifeState; suggestions: DouQiLifeSuggestion[]; sending: boolean; draft: string; onDraftChange: (value: string) => void; onSend: (action?: string) => void }) {
    const inputRef = useRef<TextAreaRef>(null);
    const battleActions = state.battle.active
        ? [
            ["攻击", "攻击眼前的敌人"], ["斗技", "施展斗技"], ["防御", "先稳住身形，进行防御"], ["移动", "向侧方移动并寻找更好的位置"], ["观察", "观察敌人的破绽"], ["道具", "使用手边的道具"], ["逃离", "寻找机会逃离战场"],
        ] as const
        : [];
    const cultivationActions = !state.battle.active
        ? [["闭关一月", "闭关修炼一个月"], ["闭关三月", "闭关修炼三个月"], ["闭关半年", "闭关修炼半年"], ["暂停修炼", "我暂不闭关，继续观察当前天地"]] as const
        : [];
    return <div className="mt-3 shrink-0 border-t border-stone-200/70 pt-3 dark:border-white/10"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-stone-500 dark:text-stone-400"><Compass className="size-3.5 text-amber-600" />你准备如何行动？</div><div className="mb-2 flex flex-wrap gap-2">{(battleActions.length ? battleActions : cultivationActions).map(([label, action]) => <Button key={label} size="small" disabled={sending} icon={battleActions.length ? (label === "移动" ? <Move className="size-3.5" /> : <Swords className="size-3.5" />) : <WandSparkles className="size-3.5" />} onClick={() => onSend(action)}>{label}</Button>)}<Button size="small" type="dashed" disabled={sending} icon={<Eye className="size-3.5" />} onClick={() => inputRef.current?.focus()}>自由行动</Button>{suggestions.map((item) => <Button key={item.id} size="small" disabled={sending} onClick={() => onSend(item.action)}>{item.label}</Button>)}</div><div className="flex items-end gap-2"><Input.TextArea ref={inputRef} value={draft} onChange={(event) => onDraftChange(event.target.value)} disabled={sending} autoSize={{ minRows: 1, maxRows: 4 }} maxLength={4_000} placeholder={state.battle.active ? "描述你的战斗行动，状态由天地裁定" : "写下你要做的事，世界会回应结果"} onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); onSend(); } }} /><Button type="primary" icon={<Send className="size-4" />} disabled={!draft.trim() || sending} loading={sending} onClick={() => onSend()}>行动</Button></div></div>;
}

function groupItems(items: DouQiLifeState["inventory"]["items"]) {
    return items.reduce<Record<string, DouQiLifeState["inventory"]["items"]>>((groups, item) => {
        (groups[item.category] ||= []).push(item);
        return groups;
    }, {});
}

function TechniqueGroup({ title, items }: { title: string; items: DouQiLifeState["techniques"] }) {
    if (!items.length) return null;
    return <div><div className="mb-1 text-stone-500">{title}</div>{items.map((technique) => <div key={technique.id} className="border-b border-stone-200/60 pb-2 last:border-0 dark:border-white/10"><div className="flex justify-between gap-2 font-medium"><span>{technique.name}</span><Tag bordered={false} color="gold">{technique.grade}</Tag></div><div className="mt-1 text-stone-500">{technique.attribute} · 熟练度 {technique.proficiency}%</div><div className="mt-1 leading-5">{technique.effect}</div><div className="mt-1 text-stone-400">来源：{technique.source}</div></div>)}</div>;
}

function isAbortError(error: unknown) {
    return error instanceof DOMException && error.name === "AbortError";
}

function LifeMessage({ item }: { item: DouQiLifeMessage }) {
    const isPlayer = item.role === "player";
    const content = item.content || (item.status === "streaming" ? "天地正在推演……" : item.error || "回应未留下痕迹");
    if (item.kind === "system") return <div className="relative flex gap-3 py-2 pl-2"><div className="mt-1 grid size-7 shrink-0 place-items-center rounded-full border border-amber-300/60 bg-amber-50 text-amber-700 dark:border-amber-200/20 dark:bg-amber-300/10 dark:text-amber-200"><Clock3 className="size-3.5" /></div><div className="min-w-0 flex-1 border-b border-dashed border-amber-300/50 pb-3 text-sm leading-7 text-stone-600 dark:border-amber-200/20 dark:text-stone-300"><div className="mb-1 text-[11px] font-medium tracking-[0.12em] text-amber-700 dark:text-amber-200">天地流转</div><div className="whitespace-pre-wrap break-words">{content}</div></div></div>;
    return <article className="relative pl-9"><div className="absolute bottom-0 left-3 top-0 w-px bg-stone-200/80 dark:bg-white/10" /><div className={cn("absolute left-0 top-1 grid size-7 place-items-center rounded-full border text-stone-500 dark:text-stone-300", isPlayer ? "border-stone-300 bg-stone-100 dark:border-white/20 dark:bg-white/10" : "border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-200/20 dark:bg-amber-300/10 dark:text-amber-200")}>{isPlayer ? <MessageCircle className="size-3.5" /> : <ChevronRight className="size-3.5" />}</div><div className={cn("border-b pb-4 text-sm leading-7", isPlayer ? "border-stone-200/70 text-stone-600 dark:border-white/10 dark:text-stone-300" : "border-amber-200/50 text-stone-800 dark:border-amber-200/10 dark:text-stone-100")}><div className="mb-1 flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-stone-500 dark:text-stone-400">{isPlayer ? "你的行动" : "天地回应"}{item.status === "streaming" ? <span className="animate-pulse text-amber-600">推演中</span> : null}{item.status === "failed" ? <span className="text-red-600 dark:text-red-300">未完成</span> : null}</div><div className="whitespace-pre-wrap break-words">{content}</div></div></article>;
}
