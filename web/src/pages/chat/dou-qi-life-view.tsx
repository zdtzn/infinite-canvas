import { App, Button, Card, Collapse, Divider, Drawer, Grid, Input, InputNumber, List, Modal, Select, Skeleton, Space, Tag } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { Archive, Backpack, BookOpen, ChevronRight, CirclePlus, Clock3, Compass, Dice5, Eye, Flame, Heart, MessageCircle, RefreshCw, Save, ScrollText, Send, Shield, Sparkles, Swords, Square, Trash2, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { type DouQiLifeCharacterInput, type DouQiLifeMessage, type DouQiLifeSave, type DouQiLifeSession, type DouQiLifeState, type DouQiLifeSuggestion } from "@/services/dou-qi-life-api";
import { useUserStore } from "@/stores/use-user-store";
import { useDouQiLife } from "./use-dou-qi-life";
import { LifeGoals, LifeRecap, SavePreviewDialog, formatSaveTime } from "./dou-qi-life-panels";
import { shouldSubmitLifeAction, usableLifeItems } from "./dou-qi-life-preferences";

type Props = { onExit: () => void };

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
    const life = useDouQiLife(userId, message);
    const { phase, activeSession, messages, saves, sessions, sending, loading } = life;
    const [character, setCharacter] = useState<DouQiLifeCharacterInput>(emptyCharacter);
    const [archivesOpen, setArchivesOpen] = useState(true);
    const [statusOpen, setStatusOpen] = useState(true);
    const [mobilePanel, setMobilePanel] = useState<"archives" | "status" | null>(null);
    const [recapOpen, setRecapOpen] = useState(false);
    const [saveOpen, setSaveOpen] = useState(false);
    const [saveTitle, setSaveTitle] = useState("");
    const [visibleCount, setVisibleCount] = useState(60);
    const screens = Grid.useBreakpoint();
    const scrollRef = useRef<HTMLDivElement>(null);
    const followRef = useRef(true);

    useEffect(() => {
        setVisibleCount(60); followRef.current = true;
        setMobilePanel(null); setRecapOpen(false); setSaveOpen(false);
    }, [activeSession?.id, userId]);

    useEffect(() => {
        if (!followRef.current) return;
        const frame = requestAnimationFrame(() => {
            const element = scrollRef.current;
            if (element) element.scrollTop = element.scrollHeight;
        });
        return () => cancelAnimationFrame(frame);
    }, [messages.at(-1)?.content, messages.length, sending, activeSession?.id]);

    function confirmNavigation(action: () => void) {
        if (!sending) { action(); return; }
        modal.confirm({
            title: "当前回应尚未完成",
            content: "继续操作会停止推演，已提交的行动会保留为未完成记录。停止不保证上游免计费。",
            okText: "停止并继续", cancelText: "继续等待",
            onOk: () => { life.stopTurn(); action(); },
        });
    }

    function newLife(random = false) {
        confirmNavigation(() => {
            setCharacter(random ? { ...randomCharacters[Math.floor(Math.random() * randomCharacters.length)] } : emptyCharacter);
            life.startNewLife(); setMobilePanel(null);
        });
    }

    function selectSession(id: string) {
        if (activeSession?.id === id && phase === "world") { setMobilePanel(null); return; }
        confirmNavigation(() => { void life.loadSession(id); setMobilePanel(null); });
    }

    function restoreSave(save: DouQiLifeSave) {
        modal.confirm({
            title: "从这个节点开辟支线？",
            content: sending ? "会停止当前推演并创建独立支线，不覆盖原人生。停止不保证上游免计费。" : "新支线保留这个节点的状态与记忆，原人生不会被覆盖。",
            okText: "开辟支线", cancelText: "取消",
            onOk: () => { life.stopTurn(); void life.restore(save); setMobilePanel(null); },
        });
    }

    function removeSession(id: string) {
        modal.confirm({
            title: "删除这段人生？", content: "人生、对话和关联自动留痕会被删除，无法恢复。",
            okText: "删除人生", cancelText: "保留", okButtonProps: { danger: true },
            onOk: () => { if (activeSession?.id === id) life.stopTurn(); return life.removeSession(id); },
        });
    }

    function removeSave(id: string) {
        modal.confirm({
            title: "删除这个存档？", content: "此操作无法恢复，不影响当前人生。",
            okText: "删除存档", cancelText: "保留", okButtonProps: { danger: true },
            onOk: () => life.removeSave(id),
        });
    }

    const archive = <LifeArchives sessions={sessions} activeId={activeSession?.id || ""} saves={saves} onSelect={selectSession} onNew={() => newLife()} onPreview={(save) => void life.openPreview(save.id)} onDelete={removeSession} onDeleteSave={removeSave} />;
    const status = activeSession ? <LifeStatus session={activeSession} /> : null;
    const player = activeSession?.state.player;
    const world = activeSession?.state.world;

    return <div className="h-full overflow-hidden bg-[#f7f5ef] text-stone-900 dark:bg-[#11100e] dark:text-[#f5efe3]">
        <div className="mx-auto flex h-full max-w-[1520px] flex-col px-3 py-3 sm:px-5 sm:py-4">
            <header className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3 dark:border-white/10">
                <div className="flex items-center gap-2"><Flame aria-hidden className="size-5 text-amber-700 dark:text-amber-200" /><div><h1 className="text-base font-semibold tracking-wider">斗气人生</h1><p className="text-xs text-stone-600 dark:text-stone-400">一段命途，由你执笔</p></div></div>
                <Button type="text" onClick={() => confirmNavigation(onExit)}>返回普通问道</Button>
            </header>
            {phase === "loading" ? <div className="grid min-h-0 flex-1 place-items-center"><div role="status" className="w-full max-w-2xl"><p className="mb-4 text-sm text-stone-500">正在读取命途…</p><Skeleton active paragraph={{ rows: 6 }} /></div></div> : null}
            {phase === "error" ? <div className="grid min-h-0 flex-1 place-items-center"><div className="max-w-md text-center"><h2 className="text-xl">命途暂未读入</h2><p role="alert" className="my-4 text-sm text-stone-600 dark:text-stone-300">{life.error}</p><Space wrap><Button type="primary" onClick={() => void life.retryLoad()} icon={<RefreshCw className="size-4" />}>重新读取</Button><Button onClick={() => newLife()}>新建人生</Button><Button onClick={onExit}>返回问道台</Button></Space></div></div> : null}
            {phase === "welcome" ? <Welcome onStart={() => newLife()} onLater={onExit} onNew={() => newLife(true)} onRestore={(save) => void life.openPreview(save.id)} saves={saves} /> : null}
            {phase === "create" ? <CharacterCreation value={character} loading={loading} onChange={setCharacter} onRandom={() => setCharacter({ ...randomCharacters[Math.floor(Math.random() * randomCharacters.length)] })} onCancel={() => void life.cancelCreate()} onSubmit={() => void life.createLife(character)} /> : null}
            {phase === "world" && activeSession && player && world ? <>
                <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm"><span className="font-medium">{player.name}</span><span className="text-amber-700 dark:text-amber-200">{player.realm} · {player.qiStage} 段</span><span className="text-xs text-stone-600 dark:text-stone-400">生命 {player.life}/{player.lifeMax} · 斗气 {player.qi}/{player.qiMax}</span>{activeSession.status === "ended" ? <Tag color="default">人生已落幕</Tag> : null}</div>
                    <Space size={4}><Button type="text" aria-expanded={screens.xl ? archivesOpen : mobilePanel === "archives"} icon={<Archive className="size-4" />} onClick={() => screens.xl ? setArchivesOpen(!archivesOpen) : setMobilePanel("archives")}>档案</Button><Button type="text" aria-expanded={screens.xl ? statusOpen : mobilePanel === "status"} icon={<Shield className="size-4" />} onClick={() => screens.xl ? setStatusOpen(!statusOpen) : setMobilePanel("status")}>状态</Button></Space>
                </div>
                <div className={cn("grid min-h-0 flex-1 gap-4", archivesOpen && statusOpen ? "xl:grid-cols-[220px_minmax(0,1fr)_280px]" : archivesOpen ? "xl:grid-cols-[220px_minmax(0,1fr)]" : statusOpen ? "xl:grid-cols-[minmax(0,1fr)_280px]" : "grid-cols-1")}>
                    {archivesOpen ? <div className="hidden min-h-0 xl:flex xl:flex-col">{archive}</div> : null}
                    <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-stone-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.02]">
                        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-3 dark:border-white/10">
                            <div className="min-w-0"><div className="flex items-center gap-2 text-sm font-medium"><Compass aria-hidden className="size-4 text-amber-700 dark:text-amber-200" />{world.location}</div><p className="mt-1 text-xs text-stone-600 dark:text-stone-400">第 {world.year} 年 · {world.month} 月 {world.day} 日 · {world.period} {world.hour} 时</p></div>
                            <Space size={4} wrap><Button type="text" icon={<BookOpen className="size-4" />} onClick={() => setRecapOpen(true)}>回顾</Button><Button type="text" disabled={sending} icon={<Save className="size-4" />} onClick={() => { setSaveTitle(`${player.name} · ${world.location}`); setSaveOpen(true); }}>存档</Button><Button type="text" icon={<CirclePlus className="size-4" />} onClick={() => newLife()}>新人生</Button></Space>
                        </div>
                        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5 sm:px-6" onScroll={(event) => { const el = event.currentTarget; followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96; }}>
                            <div className="mx-auto max-w-3xl space-y-5">
                                {messages.length > visibleCount ? <Button block type="text" onClick={() => { followRef.current = false; setVisibleCount((count) => count + 60); }}>查看更早的记录（还有 {messages.length - visibleCount} 条）</Button> : null}
                                {messages.slice(-visibleCount).map((item, offset) => { const index = Math.max(0, messages.length - visibleCount) + offset; return <LifeMessage key={item.id} item={item} retryDisabled={sending} onRetry={item.status === "failed" && messages[index - 1]?.role === "player" ? () => void life.send(messages[index - 1].content) : undefined} />; })}
                            </div>
                        </div>
                        <div className="max-h-[45%] shrink-0 overflow-y-auto px-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-5">
                            {life.error ? <div role="alert" className="pt-3 text-sm text-red-700 dark:text-red-300">{life.error}</div> : null}
                            <ActionDock key={activeSession.id} state={activeSession.state} ended={activeSession.status === "ended"} suggestions={life.suggestions} sending={sending} elapsed={life.elapsed} draft={life.draft} onDraftChange={life.setDraft} onSend={(action) => { followRef.current = true; void life.send(action); }} onStop={life.stopTurn} />
                        </div>
                    </main>
                    {statusOpen ? <div className="hidden min-h-0 xl:flex xl:flex-col">{status}</div> : null}
                </div>
            </> : null}
        </div>
        <Drawer title={mobilePanel === "archives" ? "人生档案" : "角色与命途"} open={!!mobilePanel && !screens.xl} onClose={() => setMobilePanel(null)} size="min(360px, calc(100vw - 24px))" destroyOnHidden>{mobilePanel === "archives" ? archive : status}</Drawer>
        <Modal title="留存命途节点" open={saveOpen} onCancel={() => setSaveOpen(false)} okText="保存节点" cancelText="取消" confirmLoading={life.saving} onOk={async () => { if (await life.save(saveTitle.trim())) setSaveOpen(false); }}>
            <label htmlFor="life-save-title" className="mb-2 block text-sm">存档名称</label><Input id="life-save-title" value={saveTitle} maxLength={80} onChange={(event) => setSaveTitle(event.target.value)} /><p className="mt-3 text-sm text-stone-500">保存当前状态与记忆，之后可以从这里开辟独立支线。</p>
        </Modal>
        <SavePreviewDialog life={life} onRestore={restoreSave} />
        <Drawer title="人生回顾" open={recapOpen} onClose={() => setRecapOpen(false)} size="min(560px, calc(100vw - 24px))" destroyOnHidden>{activeSession ? <LifeRecap session={activeSession} /> : null}</Drawer>
    </div>;
}
function Welcome({ onStart, onLater, onNew, onRestore, saves }: { onStart: () => void; onLater: () => void; onNew: () => void; onRestore: (save: DouQiLifeSave) => void; saves: DouQiLifeSave[] }) {
    return <div className="grid min-h-0 flex-1 place-items-center"><div className="w-full max-w-xl rounded-2xl border border-amber-200/70 bg-white/70 p-8 text-center shadow-sm dark:border-amber-200/10 dark:bg-white/[0.04]"><div className="mx-auto grid size-14 place-items-center rounded-full border border-amber-300/60 bg-amber-50 text-amber-700 dark:border-amber-200/20 dark:bg-amber-300/10 dark:text-amber-200"><Sparkles className="size-6" /></div><h1 className="mt-5 text-2xl font-semibold tracking-[0.12em]">欢迎来到斗气大陆</h1><div className="mt-3 space-y-1 text-sm leading-7 text-stone-500 dark:text-stone-400"><p>这里没有既定的主角。</p><p>你的一念一行，都会成为自己的因果。</p><p>你将以一道化身入局，站内境界不替代此世修为。</p></div><Space className="mt-6"><Button type="primary" onClick={onStart}>开始我的人生</Button><Button onClick={onLater}>以后再说</Button><Button type="text" onClick={onNew}>随机入世</Button></Space>{saves.length ? <div className="mt-8 text-left"><div className="mb-2 text-xs text-stone-500">已有存档</div><List size="small" dataSource={saves.filter((save) => save.kind === "manual")} renderItem={(save) => <List.Item actions={[<Button key="restore" type="link" onClick={() => onRestore(save)}>预览节点</Button>]}>{save.title}</List.Item>} /></div> : null}</div></div>;
}

function CharacterCreation({ value, loading, onChange, onRandom, onCancel, onSubmit }: { value: DouQiLifeCharacterInput; loading: boolean; onChange: (value: DouQiLifeCharacterInput) => void; onRandom: () => void; onCancel: () => void; onSubmit: () => void }) {
    const [step, setStep] = useState(0);
    const groups: Array<{ title: string; hint: string; fields: Array<{ key: "name" | "gender" | "age" | "birthplace" | "race" | "familyBackground" | "personality" | "appearance" | "lifeGoal" | "talent"; label: string; placeholder: string; kind?: "gender" | "age" }> }> = [
        { title: "先定下你的身份", hint: "姓名、年龄和性别会成为这段人生的第一笔。", fields: [{ key: "name", label: "姓名", placeholder: "为自己取一个名字" }, { key: "gender", label: "性别", placeholder: "选择你的性别", kind: "gender" }, { key: "age", label: "年龄", placeholder: "你的年龄", kind: "age" }] },
        { title: "决定你的来处", hint: "出身会影响你初见世界时拥有的视角。", fields: [{ key: "birthplace", label: "出生地", placeholder: "例如：青山镇" }, { key: "race", label: "种族", placeholder: "例如：人族" }, { key: "familyBackground", label: "家庭背景", placeholder: "你从怎样的家庭来" }] },
        { title: "让世界记住你的样子", hint: "性格和外貌会影响 NPC 对你的第一印象。", fields: [{ key: "personality", label: "性格", placeholder: "你如何面对世界" }, { key: "appearance", label: "外貌", placeholder: "让世界初见你的样子" }] },
        { title: "写下你想追寻的东西", hint: "目标和天赋不会替你决定命运，只会让世界更懂你。", fields: [{ key: "lifeGoal", label: "人生目标", placeholder: "你想追寻什么" }, { key: "talent", label: "天赋", placeholder: "尚未觉醒也可以" }] },
    ];
    const current = groups[step];
    const set = (key: keyof DouQiLifeCharacterInput, next: string | number) => onChange({ ...value, [key]: next });
    const next = () => step === groups.length - 1 ? onSubmit() : setStep((currentStep) => currentStep + 1);
    return <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-3xl"><div className="mb-4 flex items-center justify-between gap-3"><div><div className="text-xl font-semibold tracking-[0.12em]">{current.title}</div><div className="mt-1 text-sm text-stone-500">第 {step + 1} / {groups.length} 步 · {current.hint}</div></div><Button icon={<Dice5 className="size-4" />} onClick={onRandom}>随机生成</Button></div><div className="mb-4 flex gap-1">{groups.map((item, index) => <span key={item.title} className={cn("h-1 flex-1 rounded-full", index <= step ? "bg-amber-500" : "bg-stone-200 dark:bg-white/10")} />)}</div><Card className="border-stone-200/80 dark:border-white/10"><div className="grid min-h-[260px] gap-5 py-8 sm:grid-cols-2">{current.fields.map((field) => <div key={field.key} className={field.kind === "age" ? "sm:max-w-xs" : ""}><label className="text-sm text-stone-500" htmlFor={`douqi-${field.key}`}>{field.label}</label>{field.kind === "gender" ? <Select id={`douqi-${field.key}`} className="mt-3 w-full" size="large" value={value.gender} options={["男", "女", "不愿说明"].map((item) => ({ value: item, label: item }))} onChange={(nextValue) => set("gender", nextValue)} /> : field.kind === "age" ? <InputNumber id={`douqi-${field.key}`} className="mt-3 w-full" size="large" min={1} max={999} value={value.age} onChange={(nextValue) => onChange({ ...value, age: Number(nextValue || 18) })} /> : <Input id={`douqi-${field.key}`} value={String(value[field.key] || "")} size="large" className="mt-3" placeholder={field.placeholder} onChange={(event) => set(field.key, event.target.value)} onPressEnter={(event) => { if (shouldSubmitLifeAction(event) && !loading) { event.preventDefault(); next(); } }} />}<div className="mt-2 text-xs text-stone-400">可以留空，天地会为你保留一条合理的来路。</div></div>)}</div><Divider /><div className="flex justify-between gap-2"><Button onClick={step ? () => setStep((currentStep) => currentStep - 1) : onCancel}>上一步</Button><Space><Button onClick={onRandom}>随机生成</Button><Button type="primary" loading={loading} onClick={next}>{step === groups.length - 1 ? "进入斗气大陆" : "下一步"}</Button></Space></div></Card></div></div>;
}

function LifeArchives({ sessions, activeId, saves, onSelect, onNew, onPreview, onDelete, onDeleteSave }: { sessions: DouQiLifeSession[]; activeId: string; saves: DouQiLifeSave[]; onSelect: (id: string) => void; onNew: () => void; onPreview: (save: DouQiLifeSave) => void; onDelete: (id: string) => void; onDeleteSave: (id: string) => void }) {
    return <aside className="min-h-0 flex-1 overflow-y-auto p-1">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-medium">人生档案</h2><Button aria-label="新建人生" type="text" icon={<CirclePlus className="size-4" />} onClick={onNew} /></div>
        <div className="space-y-2">{sessions.map((session) => <div key={session.id} className={cn("flex items-center gap-1 rounded-lg px-2 py-2 text-sm", activeId === session.id ? "bg-black/5 dark:bg-white/[0.07]" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]")}>
            <button className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline focus-visible:outline-2" aria-current={activeId === session.id ? "true" : undefined} onClick={() => onSelect(session.id)}>
                <div className="break-words font-medium">{session.title}</div><p className="mt-1 text-xs text-stone-600 dark:text-stone-400">{session.state.world.location} · {session.state.player.realm}</p>
                <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">{session.status === "ended" ? "已落幕" : session.state.memory.branchOrigin ? "支线人生" : "进行中"}</p>
            </button><Button aria-label={`删除${session.title}`} type="text" icon={<Trash2 className="size-4" />} onClick={() => onDelete(session.id)} />
        </div>)}</div>
        <Divider className="my-4" /><h2 className="mb-3 flex items-center gap-2 text-sm font-medium"><ScrollText aria-hidden className="size-4" />命途节点</h2>
        {saves.length ? <div className="space-y-3">{saves.map((save) => <div key={save.id} className="flex items-center gap-1">
            <button className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline focus-visible:outline-2" onClick={() => onPreview(save)}><span className="block break-words text-sm">{save.title}</span><span className="mt-1 block text-xs text-stone-600 dark:text-stone-400">{save.kind === "auto" ? "自动留痕" : "手动存档"} · {formatSaveTime(save.updatedAt)}</span><span className="mt-1 block text-xs text-amber-700 dark:text-amber-200">预览节点 →</span></button>
            {save.kind === "manual" ? <Button aria-label={`删除存档${save.title}`} type="text" icon={<Trash2 className="size-4" />} onClick={() => onDeleteSave(save.id)} /> : null}
        </div>)}</div> : <p className="text-sm leading-6 text-stone-600 dark:text-stone-400">尚无命途节点。用正文上方的“存档”留存这一刻。</p>}
    </aside>;
}

function LifeStatus({ session }: { session: DouQiLifeSession }) {
    const { player, inventory, battle } = session.state;
    const itemGroups = groupItems(inventory.items);
    const panels = [
        { key: "character", label: "角色详情", icon: <UserRound className="size-4" />, children: <div className="space-y-2 text-xs leading-5"><div><span className="text-stone-500">出身：</span>{player.familyBackground}</div><div><span className="text-stone-500">性格：</span>{player.personality}</div><div><span className="text-stone-500">外貌：</span>{player.appearance}</div><div><span className="text-stone-500">目标：</span>{player.lifeGoal}</div><div><span className="text-stone-500">天赋：</span>{player.talent}</div></div> },
        { key: "inventory", label: `背包 · ${inventory.items.length}`, icon: <Backpack className="size-4" />, children: <div className="space-y-3 text-xs"><div className="flex items-center justify-between"><span className="text-stone-500">灵石</span><span>{inventory.gold}</span></div>{Object.entries(itemGroups).map(([category, items]) => <div key={category}><div className="mb-1 text-stone-500">{category}</div>{items.map((item) => <div key={item.id} className="flex justify-between gap-2 py-1"><span className="truncate" title={item.description}>{item.name}</span><span className="shrink-0">×{item.quantity}</span></div>)}</div>)}{!inventory.items.length ? <div className="text-stone-400">背包尚空</div> : null}</div> },
        { key: "techniques", label: `功法与斗技 · ${session.state.techniques.length}`, icon: <BookOpen className="size-4" />, children: <div className="space-y-3 text-xs"><TechniqueGroup title="功法" items={session.state.techniques.filter((technique) => technique.kind === "功法")} /><TechniqueGroup title="斗技" items={session.state.techniques.filter((technique) => technique.kind === "斗技")} />{!session.state.techniques.length ? <div className="text-stone-400">尚未获得功法或斗技</div> : null}</div> },
        { key: "npcs", label: `NPC 关系 · ${session.state.npcs.length}`, icon: <UserRound className="size-4" />, children: <div className="space-y-2 text-xs">{session.state.npcs.map((npc) => <div key={npc.id} className="border-b border-stone-200/60 pb-2 last:border-0 dark:border-white/10"><div className="flex items-center justify-between gap-2 font-medium"><span>{npc.name}</span><Tag variant="filled">{npc.relationship > 0 ? `关系 +${npc.relationship}` : `关系 ${npc.relationship}`}</Tag></div><div className="mt-1 text-stone-500">{npc.identity} · {npc.realm} · {npc.faction}</div><div className="mt-1 leading-5">印象：{npc.impression}</div><div className="mt-1 text-stone-400">最近见于：{npc.lastSeenAt}</div></div>)}{!session.state.npcs.length ? <div className="text-stone-400">尚未遇见重要人物</div> : null}</div> },
        { key: "events", label: `世界事件 · ${session.state.memory.worldEvents.filter((event) => event.known).length}`, icon: <Eye className="size-4" />, children: <div className="space-y-2 text-xs">{session.state.memory.worldEvents.filter((event) => event.known).map((event) => <div key={event.id} className="border-b border-stone-200/60 pb-2 last:border-0 dark:border-white/10"><div className="flex items-center justify-between gap-2 font-medium"><span>{event.title}</span><Tag variant="filled">{worldEventStatusLabel(event.status)}</Tag></div><div className="mt-1 text-stone-500">{event.location} · {event.occurredAt}</div><div className="mt-1 leading-5">{event.description}</div></div>)}{!session.state.memory.worldEvents.some((event) => event.known) ? <div className="text-stone-400">天地尚未显露事件</div> : null}</div> },
    ];
    return <aside className="min-h-0 flex-1 overflow-y-auto p-1"><div className="flex items-center gap-2"><Shield className="size-4 text-amber-600" /><span className="font-medium">{player.name}</span></div><div className="mt-1 text-xs text-stone-500">{player.gender} · {player.age} 岁 · 寿元 {player.lifespan} 岁 · {player.race}</div><div className="mt-1 text-sm font-medium text-amber-700 dark:text-amber-200">{player.realm} · {player.qiStage} 段</div><Divider className="my-3" /><StatusBar icon={<Flame className="size-3.5" />} label="斗气" value={player.qi} max={player.qiMax} /><StatusBar icon={<Heart className="size-3.5" />} label="生命" value={player.life} max={player.lifeMax} /><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.04]"><div className="text-stone-500">心境</div><div className="mt-1 font-medium">{player.mood}</div></div><div className="rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.04]"><div className="text-stone-500">状态</div><div className="mt-1 font-medium">{player.condition}</div></div></div>{battle.active ? <div className="mt-4 rounded-lg border border-red-200/70 bg-red-50/50 p-3 text-xs dark:border-red-300/10 dark:bg-red-300/[0.06]"><div className="flex items-center gap-2 font-medium text-red-700 dark:text-red-200"><Swords className="size-3.5" />{battle.enemyName} · {battle.enemyRealm}</div><div className="mt-1">敌方生命 {battle.enemyLife} / {battle.enemyLifeMax}</div><div className="mt-1 text-stone-500">{battle.status}</div></div> : null}<div className="mt-5"><LifeGoals state={session.state} /></div><Collapse className="mt-3" ghost items={panels} /></aside>;
}

function StatusBar({ icon, label, value, max }: { icon: React.ReactNode; label: string; value: number; max: number }) {
    const ratio = Math.max(0, Math.min(1, max ? value / max : 0));
    return <div className="mt-3"><div className="flex items-center justify-between text-xs"><span className="flex items-center gap-1.5 text-stone-500">{icon}{label}</span><span>{value} / {max}</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"><div className="h-full rounded-full bg-amber-500 transition-[width] duration-300" style={{ width: `${ratio * 100}%` }} /></div></div>;
}

export function ActionDock({ state, ended, suggestions, sending, elapsed, draft, onDraftChange, onSend, onStop }: { state: DouQiLifeState; ended: boolean; suggestions: DouQiLifeSuggestion[]; sending: boolean; elapsed: number; draft: string; onDraftChange: (value: string) => void; onSend: (action?: string) => void; onStop: () => void }) {
    const inputRef = useRef<TextAreaRef>(null);
    const [techniqueId, setTechniqueId] = useState("");
    const [itemId, setItemId] = useState("");
    const techniques = state.techniques.filter((item) => item.kind === "斗技");
    const items = usableLifeItems(state);
    const technique = techniques.find((item) => item.id === techniqueId) || techniques[0];
    const item = items.find((entry) => entry.id === itemId) || items[0];
    const actions = state.battle.active ? [["攻击", "攻击眼前的敌人"], ["防御", "先稳住身形，进行防御"], ["观察", "观察敌人的破绽"], ["逃离", "寻找机会逃离战场"]] : state.player.life <= 0 ? [["休养一天", "我先休养一天，接受天地自然恢复"]] : suggestions.length ? suggestions.slice(0, 3).map((entry) => [entry.label, entry.action]) : [["观察", "我先观察周围的环境"], ["探索", "我向前探索，留意沿途的人与事"], ["修炼一日", "我寻找合适的地方修炼一日"]];
    return <div className="mt-3 border-t border-stone-200 pt-3 dark:border-white/10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{ended ? "这段人生已经落幕" : sending ? `正在推演 · ${elapsed} 秒` : state.battle.active ? "战斗行动" : "你准备如何行动？"}</span>
            {sending ? <Button onClick={onStop} icon={<Square className="size-3.5" />}>停止推演</Button> : null}
        </div>
        {!ended ? <>
            <div className="mb-3 flex flex-wrap gap-2">{actions.map(([label, action]) => <Button key={label} disabled={sending} onClick={() => onSend(action)}>{label}</Button>)}<Button type="text" onClick={() => inputRef.current?.focus()}>自由行动</Button></div>
            {state.battle.active && (technique || item) ? <details className="mb-3"><summary className="cursor-pointer text-sm text-stone-600 focus-visible:outline focus-visible:outline-2 dark:text-stone-300">斗技与道具 · 选择具体资源</summary><div className="mt-3 space-y-3">
                {technique ? <div><label htmlFor="life-technique" className="mb-2 block text-xs text-stone-600 dark:text-stone-400">斗技 · 消耗 12 斗气{state.player.qi < 12 ? " · 当前斗气不足" : ""}</label><div className="flex gap-2"><Select id="life-technique" className="min-w-0 flex-1" value={technique.id} onChange={setTechniqueId} options={techniques.map((entry) => ({ value: entry.id, label: `${entry.name} · ${entry.grade}` }))} /><Button disabled={sending || state.player.qi < 12} onClick={() => onSend(`施展斗技：${technique.name}`)}>施展</Button></div></div> : null}
                {item ? <div><label htmlFor="life-item" className="mb-2 block text-xs text-stone-600 dark:text-stone-400">恢复道具 · 每次消耗 1 份</label><div className="flex gap-2"><Select id="life-item" className="min-w-0 flex-1" value={item.id} onChange={setItemId} options={items.map((entry) => ({ value: entry.id, label: `${entry.name} ×${entry.quantity}` }))} /><Button disabled={sending} onClick={() => onSend(`使用道具：${item.name}`)}>使用</Button></div></div> : null}
            </div></details> : null}
            <label htmlFor="life-action" className="sr-only">行动描述</label><div className="flex items-end gap-2"><Input.TextArea id="life-action" ref={inputRef} value={draft} onChange={(event) => onDraftChange(event.target.value)} autoSize={{ minRows: 1, maxRows: 4 }} maxLength={4_000} className="!text-base" placeholder={sending ? "可先写好下一步，当前回应结束后再行动" : state.battle.active ? "描述战斗行动，战斗期间不能修炼或突破" : "写下你要做的事"} onPressEnter={(event) => { if (shouldSubmitLifeAction(event) && !sending) { event.preventDefault(); onSend(); } }} /><Button type="primary" icon={<Send className="size-4" />} disabled={!draft.trim() || sending} onClick={() => onSend()}>行动</Button></div>
            <p className="mt-2 text-xs leading-5 text-stone-600 dark:text-stone-400">{sending ? "推演尚未完成，可随时停止；停止不保证上游免计费。" : state.battle.active ? `普通攻击最多消耗 5 斗气（当前实际 ${Math.min(state.player.qi, 5)}）；修炼需先结束战斗。` : "Enter 行动 · Shift + Enter 换行 · 中文选字不会提交"}</p>
        </> : <p className="text-sm leading-6 text-stone-600 dark:text-stone-400">在“回顾”中回望这段人生，或预览命途节点后开辟新的支线。</p>}
    </div>;
}

function groupItems(items: DouQiLifeState["inventory"]["items"]) {
    return items.reduce<Record<string, DouQiLifeState["inventory"]["items"]>>((groups, item) => {
        (groups[item.category] ||= []).push(item);
        return groups;
    }, {});
}

function worldEventStatusLabel(status: string) {
    return { open: "未决", investigating: "调查中", participating: "已介入", ignored: "已忽略", resolved: "已解决", escaped: "已避开" }[status] || status;
}

function TechniqueGroup({ title, items }: { title: string; items: DouQiLifeState["techniques"] }) {
    if (!items.length) return null;
    return <div><div className="mb-1 text-stone-500">{title}</div>{items.map((technique) => <div key={technique.id} className="border-b border-stone-200/60 pb-2 last:border-0 dark:border-white/10"><div className="flex justify-between gap-2 font-medium"><span>{technique.name}</span><Tag variant="filled" color="gold">{technique.grade}</Tag></div><div className="mt-1 text-stone-500">{technique.attribute} · 熟练度 {technique.proficiency}%</div><div className="mt-1 leading-5">{technique.effect}</div><div className="mt-1 text-stone-400">来源：{technique.source}</div></div>)}</div>;
}

function isAbortError(error: unknown) {
    return error instanceof DOMException && error.name === "AbortError";
}

function LifeMessage({ item, onRetry, retryDisabled }: { item: DouQiLifeMessage; onRetry?: () => void; retryDisabled: boolean }) {
    const isPlayer = item.role === "player";
    const content = item.content || (item.status === "streaming" ? "天地正在推演……" : item.error || "回应未留下痕迹");
    if (item.kind === "system") return <div className="relative flex gap-3 py-2 pl-2"><div className="mt-1 grid size-7 shrink-0 place-items-center rounded-full border border-amber-300/60 bg-amber-50 text-amber-700 dark:border-amber-200/20 dark:bg-amber-300/10 dark:text-amber-200"><Clock3 className="size-3.5" /></div><div className="min-w-0 flex-1 border-b border-dashed border-amber-300/50 pb-3 text-sm leading-7 text-stone-600 dark:border-amber-200/20 dark:text-stone-300"><div className="mb-1 text-[11px] font-medium tracking-[0.12em] text-amber-700 dark:text-amber-200">天地流转</div><div className="whitespace-pre-wrap break-words">{content}</div></div></div>;
    return <article className="relative pl-9"><div className="absolute bottom-0 left-3 top-1 w-px bg-stone-200/80 dark:bg-white/10" /><div className={cn("absolute left-0 top-1 grid size-7 place-items-center rounded-full border text-stone-500 dark:text-stone-300", isPlayer ? "border-stone-300 bg-stone-100 dark:border-white/20 dark:bg-white/10" : "border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-200/20 dark:bg-amber-300/10 dark:text-amber-200")}>{isPlayer ? <MessageCircle className="size-3.5" /> : <ChevronRight className="size-3.5" />}</div><div className={cn("border-b pb-4 text-sm leading-7", isPlayer ? "border-stone-200/70 text-stone-600 dark:border-white/10 dark:text-stone-300" : "border-amber-200/50 text-stone-800 dark:border-amber-200/10 dark:text-stone-100")}><div className="mb-1 flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-stone-500 dark:text-stone-400">{isPlayer ? "你的行动" : "天地回应"}{item.status === "streaming" ? <span className="motion-safe:animate-pulse text-amber-700 dark:text-amber-200">推演中</span> : null}{item.status === "failed" ? <span className="text-red-600 dark:text-red-300">未完成</span> : null}</div><div className="whitespace-pre-wrap break-words">{content}</div>{!isPlayer && item.metadata.notice ? <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">规则结算：{item.metadata.notice}</p> : null}{!isPlayer && item.metadata.changes?.length ? <div className="mt-3 flex flex-wrap gap-1.5">{item.metadata.changes.map((change) => <Tag key={change} variant="filled" color="gold">{change}</Tag>)}</div> : null}{item.status === "failed" ? <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{item.error || "回应未完成，可以编辑行动后重试。"}</p> : null}{item.status === "failed" && onRetry ? <Button disabled={retryDisabled} type="link" size="small" className="!px-0" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>重试这一步</Button> : null}</div></article>;
}
