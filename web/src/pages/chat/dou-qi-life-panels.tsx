import { Button, Input, Modal, Skeleton, Tag } from "antd";
import { BookOpen, GitBranch, Target } from "lucide-react";
import { useEffect, useState } from "react";
import type { DouQiLifeSession, DouQiLifeState, DouQiLifeSave } from "@/services/dou-qi-life-api";
import type { useDouQiLife } from "./use-dou-qi-life";

const muted = "text-sm leading-6 text-stone-600 dark:text-stone-400";
export const eventStatusLabel = (status: string) => ({ open: "未决", investigating: "调查中", participating: "已介入", ignored: "已忽略", resolved: "已解决", escaped: "已避开" }[status] || status);
export const formatSaveTime = (time: number) => new Date(time).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function LifeGoals({ state }: { state: DouQiLifeState }) {
    const events = state.memory.worldEvents.filter((event) => event.known);
    const open = events.filter((event) => ["open", "investigating", "participating"].includes(event.status));
    const resolved = events.filter((event) => ["resolved", "escaped", "ignored"].includes(event.status));
    const goals = [...new Set(state.memory.unresolvedGoals || [])];
    return <section className="mb-5 border-b border-stone-200 pb-4 dark:border-white/10">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium"><Target aria-hidden className="size-4 text-amber-700 dark:text-amber-200" />当前命途</h2>
        <p className="mb-3 text-sm leading-6">{state.player.lifeGoal || "先看清眼前的天地"}</p>
        {goals.length ? <ul className="mb-3 space-y-2 text-sm">{goals.map((goal) => <li key={goal} className="border-l-2 border-amber-500/50 pl-3">{goal}</li>)}</ul> : null}
        {open.map((event) => <div key={event.id} className="mb-3"><div className="flex flex-wrap items-center gap-2 text-sm"><span>{event.title}</span><Tag variant="filled">{eventStatusLabel(event.status)}</Tag></div><p className={muted}>{event.location} · {event.description}</p></div>)}
        {state.memory.recentEvents.length ? <details className="mb-3"><summary className="cursor-pointer text-sm focus-visible:outline focus-visible:outline-2">近期线索 · {state.memory.recentEvents.length}</summary><ul className={`mt-2 space-y-2 ${muted}`}>{state.memory.recentEvents.slice(-6).map((event, i) => <li key={i}>{event}</li>)}</ul></details> : null}
        {resolved.length ? <details><summary className="cursor-pointer text-sm focus-visible:outline focus-visible:outline-2">已收束的因果 · {resolved.length}</summary><ul className={`mt-2 space-y-2 ${muted}`}>{resolved.map((event) => <li key={event.id}>{event.title} · {eventStatusLabel(event.status)}</li>)}</ul></details> : null}
        {!goals.length && !open.length ? <p className={muted}>尚未发现新的未决线索，观察和探索会让命途逐渐清晰。</p> : null}
    </section>;
}

export function LifeRecap({ session }: { session: DouQiLifeSession }) {
    const { player, world, memory, npcs } = session.state;
    return <div className="space-y-6 break-words">
        <div><h2 className="text-xl font-medium">{player.name}的命途</h2><p className={`mt-2 ${muted}`}>{player.realm} · {player.age} 岁 · {world.location} · 已行 {memory.turnCount || 0} 回合</p>{memory.branchOrigin ? <p className={`mt-2 flex items-center gap-2 ${muted}`}><GitBranch aria-hidden className="size-4 shrink-0" />支线起点：{memory.branchOrigin.title}</p> : null}</div>
        <section><h3 className="mb-2 font-medium">人生纪要</h3><p className="whitespace-pre-wrap text-sm leading-7">{memory.storySummary || "命途刚刚展开，继续行动后会留下更多回忆。"}</p></section>
        <section><h3 className="mb-2 font-medium">关键选择</h3>{memory.choices.length ? <ol className="space-y-3 border-l border-stone-200 pl-4 text-sm leading-6 dark:border-white/10">{memory.choices.map((choice, i) => <li key={i}>{choice}</li>)}</ol> : <p className={muted}>尚未留下关键选择。</p>}</section>
        <section><h3 className="mb-2 font-medium">重要相识</h3>{npcs.length ? <ul className="space-y-3">{npcs.map((npc) => <li key={npc.id}><div className="text-sm">{npc.name} · {npc.identity} · 关系 {npc.relationship > 0 ? "+" : ""}{npc.relationship}</div><p className={muted}>{npc.impression}</p></li>)}</ul> : <p className={muted}>尚未遇见重要人物。</p>}</section>
        <section><h3 className="mb-2 font-medium">已记住的因果</h3>{memory.longTermFacts.length ? <ul className={`space-y-2 ${muted}`}>{memory.longTermFacts.map((fact, i) => <li key={i}>{fact}</li>)}</ul> : <p className={muted}>尚无长期记忆。</p>}</section>
        <LifeGoals state={session.state} />
    </div>;
}

export function SavePreviewDialog({ life, onRestore }: { life: ReturnType<typeof useDouQiLife>; onRestore: (save: DouQiLifeSave) => void }) {
    const { preview, previewLoading, previewError, previewId } = life;
    const [title, setTitle] = useState("");
    const [renaming, setRenaming] = useState(false);
    useEffect(() => { setTitle(preview?.save.title || ""); setRenaming(false); }, [preview?.save.id, preview?.save.title]);
    return <Modal title="命途节点预览" open={!!previewId} onCancel={life.closePreview} footer={preview ? [<Button key="cancel" onClick={life.closePreview}>返回</Button>, <Button key="restore" type="primary" onClick={() => onRestore(preview.save)}>从此开辟支线</Button>] : null} destroyOnHidden>
        {previewLoading ? <Skeleton active paragraph={{ rows: 5 }} /> : preview ? <div className="space-y-4">
            <div><h2 className="text-lg font-medium">{preview.save.title}</h2><p className={muted}>{preview.save.kind === "auto" ? "自动留痕" : "手动存档"} · {formatSaveTime(preview.save.updatedAt)}</p></div>
            <div className="grid grid-cols-2 gap-3 border-y border-stone-200 py-3 text-sm dark:border-white/10"><div>{preview.state.player.name}<p className={muted}>{preview.state.player.realm} · {preview.state.player.qiStage} 段</p></div><div>{preview.state.world.location}<p className={muted}>第 {preview.state.world.year} 年 · {preview.state.world.month} 月 {preview.state.world.day} 日</p></div></div>
            {preview.state.memory.branchOrigin ? <p className={muted}>来源支线：{preview.state.memory.branchOrigin.title}</p> : <p className={muted}>来源人生：{preview.title}</p>}
            <section><h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><BookOpen aria-hidden className="size-4" />此刻的故事</h3><p className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-7">{preview.lastNarrative || "此刻尚未留下叙事。"}</p></section>
            {preview.save.kind === "manual" ? <div><label htmlFor="rename-life-save" className="mb-2 block text-sm">存档名称</label><div className="flex gap-2"><Input id="rename-life-save" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} /><Button loading={renaming} disabled={!title.trim() || title.trim() === preview.save.title} onClick={async () => { setRenaming(true); await life.renameSave(preview.save.id, title.trim()); setRenaming(false); }}>改名</Button></div></div> : null}
            <p className={muted}>预览不会推进时间，开辟支线也不会覆盖原人生。</p>
        </div> : <div role="alert"><p className="mb-3">{previewError || "此节点暂不可读取"}</p><Button onClick={() => void life.openPreview(previewId)}>重试预览</Button></div>}
    </Modal>;
}
