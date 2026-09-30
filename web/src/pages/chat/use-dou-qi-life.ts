import { useEffect, useRef, useState } from "react";
import { useUserStore } from "@/stores/use-user-store";
import { createDouQiLifeSession, deleteDouQiLifeSave, deleteDouQiLifeSession, fetchDouQiLifeSavePreview, fetchDouQiLifeSaves, fetchDouQiLifeSession, fetchDouQiLifeSessions, renameDouQiLifeSave, restoreDouQiLifeSave, saveDouQiLifeSession, sendDouQiLifeTurn, type DouQiLifeCharacterInput, type DouQiLifeDetail, type DouQiLifeMessage, type DouQiLifeSave, type DouQiLifeSavePreview, type DouQiLifeSession, type DouQiLifeSuggestion } from "@/services/dou-qi-life-api";
import { readLifePreference, writeLifePreference } from "./dou-qi-life-preferences";

type Phase = "loading" | "error" | "welcome" | "create" | "world";
type Notice = { error: (text: string) => unknown; info: (text: string) => unknown; success: (text: string) => unknown };
type PendingTurn = { token: number; generation: number; controller: AbortController; action: string; worldId: string; terminal: boolean };

export function useDouQiLife(userId: string, notice: Notice) {
    const [phase, setPhase] = useState<Phase>("loading");
    const [sessions, setSessions] = useState<DouQiLifeSession[]>([]);
    const [activeSession, setActiveSession] = useState<DouQiLifeSession | null>(null);
    const [messages, setMessages] = useState<DouQiLifeMessage[]>([]);
    const [saves, setSaves] = useState<DouQiLifeSave[]>([]);
    const [suggestions, setSuggestions] = useState<DouQiLifeSuggestion[]>([]);
    const [draft, setDraft] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [saving, setSaving] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [preview, setPreview] = useState<DouQiLifeSavePreview | null>(null);
    const [previewId, setPreviewId] = useState("");
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState("");
    const mounted = useRef(false);
    const owner = useRef(userId);
    const epoch = useRef(0);
    const selectedId = useRef("");
    const pending = useRef<PendingTurn | null>(null);
    const turnGeneration = useRef(0);
    const drafts = useRef<Record<string, string>>({});
    const draftRef = useRef(draft);
    const previewToken = useRef(0);
    const savingRef = useRef(false);
    const creatingRef = useRef<number | null>(null);
    draftRef.current = draft;
    const current = (token: number) => mounted.current && epoch.current === token && useUserStore.getState().user?.id === userId;
    const currentTurn = (turn: PendingTurn) => current(turn.token) && pending.current === turn;
    const errorText = (value: unknown, fallback: string) => value instanceof Error ? value.message : fallback;

    useEffect(() => {
        mounted.current = true;
        owner.current = userId;
        drafts.current = {};
        selectedId.current = "";
        creatingRef.current = null;
        setActiveSession(null); setMessages([]); setSessions([]); setSaves([]); setDraft("");
        void initialize();
        return () => {
            mounted.current = false;
            epoch.current++;
            previewToken.current++;
            pending.current?.controller.abort();
            pending.current = null;
        };
    }, [userId]);

    useEffect(() => {
        if (!sending) return;
        const start = Date.now();
        setElapsed(0);
        const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
        return () => clearInterval(timer);
    }, [sending]);

    function rememberDraft() {
        if (selectedId.current) drafts.current[selectedId.current] = draftRef.current;
    }

    function stopTurn() {
        const turn = pending.current;
        if (!turn || turn.terminal) return;
        turn.controller.abort();
        if (currentTurn(turn)) {
            failMessage(turn, "已停止推演，可编辑行动后重试。停止不保证上游免计费。");
            if (!draftRef.current) setDraft(turn.action);
            setSending(false);
            void reconcileInterruptedTurn(selectedId.current, turn);
        }
        pending.current = null;
    }

    function beginNavigation() {
        rememberDraft(); stopTurn();
        const token = ++epoch.current;
        previewToken.current++;
        setPreview(null); setPreviewId(""); setPreviewLoading(false);
        savingRef.current = false; setSaving(false); setSending(false);
        setError(""); setLoading(true); setPhase("loading");
        return token;
    }

    async function initialize() {
        const token = beginNavigation();
        try {
            const result = await fetchDouQiLifeSessions(userId);
            if (!current(token)) return;
            setSessions(result.items);
            if (result.items.length) {
                const lastId = readLifePreference(userId, "session");
                const next = result.items.find((item) => item.id === lastId) || result.items[0];
                await loadSession(next.id);
            } else {
                const result = await fetchDouQiLifeSaves(undefined, userId);
                if (!current(token)) return;
                setSaves(result.items); setPhase("welcome");
            }
        } catch (value) {
            if (current(token)) { setError(errorText(value, "斗气人生加载失败")); setPhase("error"); }
        } finally { if (current(token)) setLoading(false); }
    }

    function applyDetail(detail: DouQiLifeDetail) {
        selectedId.current = detail.session.id;
        setActiveSession(detail.session);
        setSessions((items) => [detail.session, ...items.filter((item) => item.id !== detail.session.id)]);
        setMessages(detail.messages);
        setSuggestions([...detail.messages].reverse().find((item) => item.role === "world" && item.status === "completed")?.metadata.suggestions || []);
        setDraft(drafts.current[detail.session.id] || "");
        writeLifePreference(userId, "session", detail.session.id);
    }

    async function loadSession(id: string) {
        if (!current(epoch.current)) return;
        const token = beginNavigation();
        selectedId.current = id;
        try {
            const [detail, result] = await Promise.all([fetchDouQiLifeSession(id, userId), fetchDouQiLifeSaves(id, userId)]);
            if (!current(token)) return;
            applyDetail(detail); setSaves(result.items); setPhase("world");
        } catch (value) {
            if (current(token)) { setError(errorText(value, "人生读取失败")); setPhase("error"); }
        } finally { if (current(token)) setLoading(false); }
    }

    function startNewLife() {
        if (!current(epoch.current)) return;
        beginNavigation(); setLoading(false); setPhase("create");
    }

    async function createLife(character: DouQiLifeCharacterInput) {
        if (loading || creatingRef.current !== null || !current(epoch.current)) return;
        const token = ++epoch.current;
        creatingRef.current = token;
        setLoading(true); setError("");
        try {
            const result = await createDouQiLifeSession(character, userId);
            if (!current(token)) return;
            setSessions((items) => [result.session, ...items]);
            await loadSession(result.session.id);
        } catch (value) {
            if (current(token)) { setPhase("create"); notice.error(errorText(value, "角色创建失败")); }
        } finally { if (creatingRef.current === token) creatingRef.current = null; if (current(token)) setLoading(false); }
    }

    function failMessage(turn: PendingTurn, text: string) {
        setMessages((items) => items.map((item) => item.id === turn.worldId ? { ...item, status: "failed", error: text } : item));
    }

    async function send(action = draftRef.current.trim()) {
        if (!activeSession || !action.trim() || pending.current || activeSession.status === "ended" || !current(epoch.current)) return;
        const sessionId = activeSession.id;
        const turn: PendingTurn = { token: epoch.current, generation: ++turnGeneration.current, controller: new AbortController(), action, worldId: "", terminal: false };
        pending.current = turn; setSending(true); setError(""); setDraft(""); drafts.current[sessionId] = "";
        try {
            await sendDouQiLifeTurn(sessionId, action, {
                expectedUserId: userId, signal: turn.controller.signal,
                onStarted: (event) => {
                    if (!currentTurn(turn)) return;
                    turn.worldId = event.worldMessage.id;
                    setActiveSession(event.session);
                    setMessages((items) => [...items, event.playerMessage, event.worldMessage].slice(-400));
                },
                onDelta: ({ messageId, delta }) => {
                    if (currentTurn(turn)) setMessages((items) => items.map((item) => item.id === messageId ? { ...item, content: item.content + delta } : item));
                },
                onDone: (event) => {
                    if (!currentTurn(turn)) return;
                    turn.terminal = true;
                    setActiveSession(event.session); setSuggestions(event.suggestions || []);
                    setMessages((items) => items.map((item) => item.id === event.worldMessage.id ? event.worldMessage : item));
                    setSessions((items) => [event.session, ...items.filter((item) => item.id !== sessionId)]);
                    void refreshSaves(sessionId, turn.token);
                    if (event.notice) notice.info(event.notice);
                },
                onError: ({ message: text }) => {
                    if (!currentTurn(turn)) return;
                    turn.terminal = true; failMessage(turn, text);
                    if (!draftRef.current) setDraft(action);
                    notice.error(text);
                },
            });
        } catch (value) {
            if (currentTurn(turn) && !turn.terminal) {
                const text = errorText(value, "世界回应暂未完成");
                failMessage(turn, text);
                void reconcileInterruptedTurn(sessionId, turn);
                if (!draftRef.current) setDraft(action);
                notice.error(text);
                if (!turn.worldId) setError(text);
            }
        } finally {
            if (currentTurn(turn)) { pending.current = null; setSending(false); }
        }
    }

    async function refreshSaves(id: string, token = epoch.current) {
        try {
            const result = await fetchDouQiLifeSaves(id, userId);
            if (current(token) && selectedId.current === id) setSaves(result.items);
        } catch { /* A successful turn remains visible even if the archive refresh fails. */ }
    }

    async function reconcileInterruptedTurn(id: string, turn: PendingTurn) {
        if (!turn.worldId) return;
        try {
            const detail = await fetchDouQiLifeSession(id, userId);
            if (!current(turn.token) || selectedId.current !== id || turnGeneration.current !== turn.generation) return;
            const completed = detail.messages.find((item) => item.id === turn.worldId && item.status === "completed");
            // The server may have committed before a terminal event reached the browser.
            if (!completed) return;
            setMessages((items) => items.map((item) => item.id === completed.id ? completed : item));
            setActiveSession(detail.session); setSuggestions(completed.metadata.suggestions || []);
            setDraft((value) => value === turn.action ? "" : value);
            setSessions((items) => [detail.session, ...items.filter((item) => item.id !== id)]);
            void refreshSaves(id, turn.token);
        } catch { /* Keep the interrupted narrative and manual retry while offline. */ }
    }

    async function save(title: string) {
        if (!activeSession || pending.current || savingRef.current || !current(epoch.current)) return false;
        const token = epoch.current;
        savingRef.current = true; setSaving(true);
        try {
            const result = await saveDouQiLifeSession({ sessionId: activeSession.id, title }, userId);
            if (!current(token)) return false;
            setSaves((items) => [result.save, ...items.filter((item) => item.id !== result.save.id)]);
            notice.success("这一刻已留存"); return true;
        } catch (value) { if (current(token)) notice.error(errorText(value, "存档失败")); return false; }
        finally { if (current(token)) { savingRef.current = false; setSaving(false); } }
    }

    async function restore(save: DouQiLifeSave) {
        if (!current(epoch.current)) return;
        const token = beginNavigation();
        try {
            const result = await restoreDouQiLifeSave(save.id, userId);
            if (!current(token)) return;
            setSessions((items) => [result.session, ...items]);
            await loadSession(result.session.id);
            if (mounted.current && useUserStore.getState().user?.id === userId) notice.success("已从此刻开辟新的命途");
        } catch (value) {
            if (current(token)) { setError(errorText(value, "存档读取失败")); setPhase("error"); }
        } finally { if (current(token)) setLoading(false); }
    }

    async function removeSession(id: string) {
        if (!current(epoch.current)) return;
        const token = epoch.current;
        try {
            await deleteDouQiLifeSession(id, userId);
            if (!current(token)) return;
            const next = sessions.filter((item) => item.id !== id);
            setSessions(next); delete drafts.current[id];
            if (selectedId.current === id) {
                stopTurn(); selectedId.current = ""; setActiveSession(null); setMessages([]);
                if (next[0]) await loadSession(next[0].id); else await initialize();
            }
        } catch (value) { if (current(token)) notice.error(errorText(value, "人生删除失败")); }
    }

    async function removeSave(id: string) {
        if (!current(epoch.current)) return;
        const token = epoch.current;
        try {
            await deleteDouQiLifeSave(id, userId);
            if (current(token)) { setSaves((items) => items.filter((item) => item.id !== id)); closePreview(); }
        } catch (value) { if (current(token)) notice.error(errorText(value, "存档删除失败")); }
    }

    async function openPreview(id: string) {
        if (!current(epoch.current)) return;
        const request = ++previewToken.current, token = epoch.current;
        setPreviewId(id); setPreview(null); setPreviewError(""); setPreviewLoading(true);
        try {
            const result = await fetchDouQiLifeSavePreview(id, userId);
            if (current(token) && request === previewToken.current) setPreview(result);
        } catch (value) {
            if (current(token) && request === previewToken.current) setPreviewError(errorText(value, "存档预览加载失败"));
        } finally { if (current(token) && request === previewToken.current) setPreviewLoading(false); }
    }

    function closePreview() { previewToken.current++; setPreviewId(""); setPreview(null); setPreviewLoading(false); }

    async function renameSave(id: string, title: string) {
        if (!current(epoch.current)) return false;
        const token = epoch.current, request = previewToken.current;
        try {
            const result = await renameDouQiLifeSave(id, title, userId);
            if (!current(token)) return false;
            setSaves((items) => items.map((item) => item.id === id ? result.save : item));
            if (request === previewToken.current) setPreview((value) => value?.save.id === id ? { ...value, save: result.save } : value);
            notice.success("存档名称已更新"); return true;
        } catch (value) { if (current(token)) notice.error(errorText(value, "存档改名失败")); return false; }
    }

    const visible = owner.current === userId;
    return { phase: visible ? phase : "loading" as Phase, sessions: visible ? sessions : [], activeSession: visible ? activeSession : null, messages: visible ? messages : [], saves: visible ? saves : [], suggestions, draft, setDraft, error, loading, sending, saving, elapsed, preview: visible ? preview : null, previewId: visible ? previewId : "", previewLoading, previewError, initialize, loadSession, startNewLife, createLife, send, stopTurn, save, restore, removeSession, removeSave, openPreview, closePreview, renameSave, retryLoad: () => selectedId.current ? loadSession(selectedId.current) : initialize(), cancelCreate: () => activeSession ? loadSession(activeSession.id) : initialize() };
}
