import { App, Button, Drawer, Dropdown, Empty, Input, Popconfirm, Segmented, Skeleton, Tag, Tooltip } from "antd";
import { BookOpen, Brain, ChevronDown, Copy, Download, FileUp, ImagePlus, LoaderCircle, MessageCircle, MoreHorizontal, Pencil, Plus, RotateCcw, Send, Sparkles, Trash2, UserRound, X } from "lucide-react";
import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from "react";
import { nanoid } from "nanoid";

import { cn } from "@/lib/utils";
import { friendlyErrorMessage, userFacingErrorMessage } from "@/lib/friendly-error";
import { lazyRoute } from "@/lib/lazy-route";
import { useCopyText } from "@/hooks/use-copy-text";
import { cancelChatMessage, ChatRequestError, createChatConversation, createChatMemory, deleteChatConversation, deleteChatMemory, fetchChatConversation, fetchChatConversationExport, fetchChatTurn, importChatConversation, sendChatMessage, truncateChatMessages, updateChatConversationPreset, updateChatMemory, uploadChatImage, type ChatAttachment, type ChatCanvasContext, type ChatConversation, type ChatMemory, type ChatMessage, type ChatStartedEvent } from "@/services/chat-api";
import { clearChatBootstrapCache, getChatBootstrapRequests } from "@/services/chat-bootstrap-cache";
import { saveServerUserPreferences } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { readChatMode, writeLifePreference } from "./dou-qi-life-preferences";
import { useCanvasContextStore } from "@/stores/use-canvas-context-store";
import { useChatRuntimeStore } from "@/stores/use-chat-runtime-store";
import { chatPresetOption, chatPresetOptions, defaultChatPresetId, type ChatPresetId, type ChatPresetOption } from "./chat-presets";
import { mergeChatHistoryWithPendingTurn, mergeStartedChatMessages, mergeLoadedChatHistory } from "./chat-message-reconciliation";
import { isAcceptedChatTurn, isChatSendBlocked, recoverChatTurn } from "./chat-turn-recovery";
import { useChatDraft } from "./use-chat-draft";
import "./chat.css";

const DouQiLifeView = lazyRoute(() => import("./dou-qi-life-view"));
const ChatMarkdown = lazyRoute(() => import("./chat-markdown"));

const welcomeLines = ["把疑问交给此方天地。", "可上传图片，让模型结合画面回答。", "这里适合聊创意、提示词、商品图、画面结构和日常问题。"];

const CHAT_PRESET_STORAGE_KEY = "infinite-canvas:chat-preset:";

type PendingChatTurn = {
    conversationId: string;
    optimisticUserId: string;
    optimisticAssistantId: string;
    createdAt: number;
    started: boolean;
    stopped: boolean;
    stopRequested: boolean;
    terminal: boolean;
    cancelRequest?: Promise<boolean>;
    userMessageId?: string;
    assistantMessageId?: string;
    retryAssistantMessageId?: string;
    editUserMessageId?: string;
    continueAssistantMessageId?: string;
    previousAssistant?: ChatMessage;
    referenceUserMessageId: string;
    userId: string;
    turnId: string;
    operationAccepted?: boolean;
};

type ChatTurnInput = {
    conversationId: string;
    content: string;
    attachments: ChatAttachment[];
    canvasContext?: ChatCanvasContext;
    retryAssistantMessageId?: string;
    editUserMessageId?: string;
    continueAssistantMessageId?: string;
    showOptimisticUser: boolean;
    clientMessageId?: string;
    optimisticAssistantId?: string;
    reconcileBeforeSend?: boolean;
    clearSubmittedDraft?: () => void;
};

type ChatMode = "chat" | "douqi";
type ChatMessageAction = "retry" | "continue" | "edit" | "delete" | "remember";

export default function ChatPage() {
    const { message, modal } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const userId = useUserStore((state) => state.user?.id || "");
    const canvasContext = useCanvasContextStore((state) => state.snapshot);
    const clearCanvasContext = useCanvasContextStore((state) => state.clear);

    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [historyPage, setHistoryPage] = useState<{ hasMore: boolean; nextBefore: string | null }>({ hasMore: false, nextBefore: null });
    const [historyLoading, setHistoryLoading] = useState(false);
    const historyRequestRef = useRef(0);
    const historyScrollAnchorRef = useRef<{ conversationId: string; height: number; top: number } | null>(null);
    const [creating, setCreating] = useState(false);
    const [importing, setImporting] = useState(false);
    const [sending, setSending] = useState(false);
    const [mode, setMode] = useState<ChatMode>(() => readChatMode(userId));
    const modeUserRef = useRef(userId);
    useEffect(() => {
        if (modeUserRef.current !== userId) {
            modeUserRef.current = userId;
            setMode(readChatMode(userId));
        } else {
            writeLifePreference(userId, "mode", mode);
        }
    }, [mode, userId]);
    const [uploading, setUploading] = useState(false);
    const ordinaryDraft = useChatDraft(userId, activeConversationId);
    const [editingDraft, setEditingDraft] = useState<{ id: string; userId: string; conversationId: string; messageId: string; draft: string; attachments: ChatAttachment[] } | null>(null);
    const editing = editingDraft?.userId === userId && editingDraft.conversationId === activeConversationId ? editingDraft : null;
    const editingMessageId = editing?.messageId || "";
    const draft = editing ? editing.draft : ordinaryDraft.draft;
    const attachments = editing ? editing.attachments : ordinaryDraft.attachments;
    const draftStorageWarnedRef = useRef(false);
    function setDraft(value: SetStateAction<string>) {
        if (!editing) return ordinaryDraft.setDraft(value);
        setEditingDraft((current) => current?.id === editing.id ? { ...current, draft: typeof value === "function" ? value(current.draft) : value } : current);
    }
    function setAttachments(value: SetStateAction<ChatAttachment[]>) {
        if (!editing) return ordinaryDraft.setAttachments(value);
        setEditingDraft((current) => current?.id === editing.id ? { ...current, attachments: typeof value === "function" ? value(current.attachments) : value } : current);
    }
    useEffect(() => {
        if (!ordinaryDraft.storageError || draftStorageWarnedRef.current) return;
        draftStorageWarnedRef.current = true;
        message.warning("草稿暂时无法保存在此浏览器，关闭页面前请先复制内容。");
    }, [message, ordinaryDraft.storageError]);
    const [presetId, setPresetId] = useState<ChatPresetId>(() => readLocalChatPreset(userId));
    const [presetReadyUser, setPresetReadyUser] = useState("");
    const [chatPersona, setChatPersona] = useState("");
    const [personaDraft, setPersonaDraft] = useState("");
    const [personaSaving, setPersonaSaving] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const [memoryOpen, setMemoryOpen] = useState(false);
    const [conversationsOpen, setConversationsOpen] = useState(false);
    const [memories, setMemories] = useState<ChatMemory[]>([]);
    const [memoryDraft, setMemoryDraft] = useState("");
    const [editingMemoryId, setEditingMemoryId] = useState("");
    const [memorySaving, setMemorySaving] = useState(false);
    const presetIdRef = useRef<ChatPresetId>(defaultChatPresetId);
    const presetEditedDuringHydration = useRef(false);
    const presetSaveQueue = useRef(Promise.resolve());
    const activeConversationIdRef = useRef("");
    const pendingTurnRef = useRef<PendingChatTurn | null>(null);
    const sendingRef = useRef(false);
    const sendStartingRef = useRef(false);
    const sendStartSequenceRef = useRef(0);
    const uploadingRef = useRef(false);
    const uploadSequenceRef = useRef(0);
    const creatingRef = useRef(false);
    const mountedRef = useRef(true);
    const pageUserIdRef = useRef(userId);
    const messagesRef = useRef(messages);
    const failedTurnsRef = useRef(new Map<string, ChatTurnInput>());
    const shouldStickToBottomRef = useRef(true);
    pageUserIdRef.current = userId;
    messagesRef.current = messages;
    const runtimePending = useChatRuntimeStore((state) => state.pending && state.userId === userId);
    const runtimeStatus = useChatRuntimeStore((state) => state.status);
    const runtimeConversationId = useChatRuntimeStore((state) => state.conversationId);

    const activeConversation = conversations.find((item) => item.id === activeConversationId) || null;
    const activePresetId = activeConversation?.presetId || presetId;
    const activePreset = chatPresetOption(activePresetId as ChatPresetId);
    const activeHasStreamingMessage = messages.some((item) => item.status === "streaming");
    const turnRunning = sending || runtimePending || activeHasStreamingMessage;

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useLayoutEffect(() => {
        pendingTurnRef.current = null;
        sendingRef.current = false;
        sendStartingRef.current = false;
        sendStartSequenceRef.current += 1;
        uploadingRef.current = false;
        uploadSequenceRef.current += 1;
        creatingRef.current = false;
        failedTurnsRef.current.clear();
        setSending(false);
        setUploading(false);
        setCreating(false);
        setMessages([]);
        setConversations([]);
        activeConversationIdRef.current = "";
        setActiveConversationId("");
        const runtime = useChatRuntimeStore.getState();
        if (runtime.userId && runtime.userId !== userId) runtime.clearRuntime();
    }, [userId]);

    useEffect(() => {
        activeConversationIdRef.current = activeConversationId;
    }, [activeConversationId]);

    useEffect(() => {
        let canceled = false;
        presetEditedDuringHydration.current = false;
        const localPresetId = readLocalChatPreset(userId);
        presetIdRef.current = localPresetId;
        setPresetId(localPresetId);
        setPresetReadyUser("");
        setChatPersona("");
        setPersonaDraft("");
        if (!userId)
            return () => {
                canceled = true;
            };

        void getChatBootstrapRequests(userId)
            .preferences.then((preferences) => {
                if (canceled) return;
                const serverPresetId = chatPresetOptions.some((preset) => preset.id === preferences.chatPresetId) ? (preferences.chatPresetId as ChatPresetId) : defaultChatPresetId;
                const nextPresetId = presetEditedDuringHydration.current ? presetIdRef.current : serverPresetId;
                presetIdRef.current = nextPresetId;
                setPresetId(nextPresetId);
                writeLocalChatPreset(userId, nextPresetId);
                const nextPersona = preferences.chatPersona || "";
                setChatPersona(nextPersona);
                setPersonaDraft(nextPersona);
                setPresetReadyUser(userId);
                if (presetEditedDuringHydration.current) {
                    enqueuePresetSave(nextPresetId, userId, () => !canceled);
                }
            })
            .catch((error) => {
                if (canceled) return;
                setPresetReadyUser(userId);
                message.error(userFacingErrorMessage(error, "问道角色加载失败"));
            });
        return () => {
            canceled = true;
        };
    }, [message, userId]);

    useEffect(() => {
        if (!userId) {
            setMemories([]);
            return;
        }
        let canceled = false;
        void getChatBootstrapRequests(userId)
            .memories.then((response) => {
                if (!canceled) setMemories(response.items);
            })
            .catch((error) => {
                if (!canceled) message.error(userFacingErrorMessage(error, "长期记忆加载失败"));
            });
        return () => {
            canceled = true;
        };
    }, [message, userId]);

    useEffect(() => {
        if (!userId) return;
        let canceled = false;
        setLoading(true);
        void getChatBootstrapRequests(userId)
            .conversations.then((response) => {
                if (canceled) return;
                setConversations(response.items);
                setActiveConversationId((current) => {
                    const next = response.items.some((item) => item.id === current) ? current : response.items[0]?.id || "";
                    activeConversationIdRef.current = next;
                    return next;
                });
            })
            .catch((error) => !canceled && message.error(userFacingErrorMessage(error, "问道记录加载失败")))
            .finally(() => !canceled && setLoading(false));
        return () => {
            canceled = true;
        };
    }, [message, userId]);

    useEffect(() => {
        if (!activeConversationId || !userId) {
            setMessages([]);
            return;
        }
        let canceled = false;
        historyRequestRef.current += 1;
        setHistoryLoading(false);
        setHistoryPage({ hasMore: false, nextBefore: null });
        setDetailLoading(true);
        void getChatBootstrapRequests(userId)
            .firstConversation.catch(() => null)
            .then((prefetched) => (prefetched?.conversation.id === activeConversationId ? prefetched : fetchChatConversation(activeConversationId, userId)))
            .then((detail) => {
                if (canceled) return;
                setHistoryPage({ hasMore: Boolean(detail.hasMore), nextBefore: detail.nextBefore || null });
                setMessages((current) => {
                    const pending = pendingTurnRef.current;
                    const merged = mergeLoadedChatHistory(current, detail.messages);
                    if (pending?.conversationId !== activeConversationId) return merged;
                    return mergeChatHistoryWithPendingTurn(current, merged, pending);
                });
                setConversations((current) => upsertConversation(current, detail.conversation));
            })
            .catch((error) => !canceled && message.error(userFacingErrorMessage(error, "对话加载失败")))
            .finally(() => !canceled && setDetailLoading(false));
        return () => {
            canceled = true;
        };
    }, [activeConversationId, message, userId]);

    useEffect(() => {
        if (!activeConversationId || !userId || !activeHasStreamingMessage) return;
        let canceled = false;
        let timer: number | undefined;

        const poll = async () => {
            try {
                const detail = await fetchChatConversation(activeConversationId, userId);
                if (canceled) return;
                setMessages((current) => {
                    const pending = pendingTurnRef.current;
                    const merged = mergeLoadedChatHistory(current, detail.messages);
                    if (pending?.conversationId !== activeConversationId) return merged;
                    return mergeChatHistoryWithPendingTurn(current, merged, pending);
                });
                setConversations((current) => upsertConversation(current, detail.conversation));
                if (detail.messages.some((item) => item.status === "streaming")) timer = window.setTimeout(() => void poll(), 1_200);
            } catch {
                if (!canceled) timer = window.setTimeout(() => void poll(), 2_000);
            }
        };

        timer = window.setTimeout(() => void poll(), 1_000);
        return () => {
            canceled = true;
            if (timer !== undefined) window.clearTimeout(timer);
        };
    }, [activeConversationId, activeHasStreamingMessage, userId]);

    useLayoutEffect(() => {
        const anchor = historyScrollAnchorRef.current;
        const element = scrollRef.current;
        if (!anchor || !element) return;
        historyScrollAnchorRef.current = null;
        if (anchor.conversationId === activeConversationId) element.scrollTop = anchor.top + element.scrollHeight - anchor.height;
    }, [messages, activeConversationId]);

    async function loadEarlierMessages() {
        if (historyLoading || !historyPage.nextBefore || !activeConversationId || detailLoading) return;
        const conversationId = activeConversationId;
        const request = ++historyRequestRef.current;
        setHistoryLoading(true);
        try {
            const detail = await fetchChatConversation(conversationId, userId, { before: historyPage.nextBefore });
            if (!isCurrentPage(userId) || activeConversationIdRef.current !== conversationId || historyRequestRef.current !== request) return;
            const element = scrollRef.current;
            if (element) historyScrollAnchorRef.current = { conversationId, top: element.scrollTop, height: element.scrollHeight };
            shouldStickToBottomRef.current = false;
            setMessages((current) => [...detail.messages.filter((item) => !current.some((existing) => existing.id === item.id)), ...current]);
            setHistoryPage({ hasMore: Boolean(detail.hasMore), nextBefore: detail.nextBefore || null });
        } catch (error) {
            if (isCurrentPage(userId) && activeConversationIdRef.current === conversationId) message.error(userFacingErrorMessage(error, "更早的问道记录暂时无法加载，请重试"));
        } finally {
            if (historyRequestRef.current === request && isCurrentPage(userId)) setHistoryLoading(false);
        }
    }

    useEffect(() => {
        if (!shouldStickToBottomRef.current) return;
        const frame = requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" });
        });
        return () => cancelAnimationFrame(frame);
    }, [messages, turnRunning]);

    useEffect(
        () => () => {
            if (userId) clearChatBootstrapCache(userId);
        },
        [userId],
    );

    const canSend = Boolean(ordinaryDraft.ready && (draft.trim() || attachments.length) && !turnRunning && !uploading && !creating);

    function handleChatScroll() {
        const element = scrollRef.current;
        if (!element) return;
        shouldStickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
    }

    function confirmPendingNavigation(action: string) {
        if ((!pendingTurnRef.current || pendingTurnRef.current.terminal) && !runtimePending) return Promise.resolve(true);
        message.info(`当前回答会在后台继续，已允许${action}`);
        return Promise.resolve(true);
    }

    function markPendingAssistantStopped(pending: PendingChatTurn) {
        if (!isCurrentPage(pending.userId) || activeConversationIdRef.current !== pending.conversationId) return;
        const assistantId = pending.retryAssistantMessageId || pending.continueAssistantMessageId || pending.assistantMessageId || pending.optimisticAssistantId;
        const stoppedMessage = "本次回答已停止";
        setMessages((current) => {
            if (current.some((item) => item.id === assistantId)) {
                return current.map((item) => (item.id === assistantId && item.status !== "completed" ? { ...item, status: "failed", error: stoppedMessage } : item));
            }
            if (pending.terminal) return current;
            return [...current, createOptimisticAssistantMessage(pending, stoppedMessage)];
        });
    }

    async function cancelPendingTurn(pending: PendingChatTurn): Promise<boolean> {
        if (pending.cancelRequest) return pending.cancelRequest;
        if (!pending.assistantMessageId) return false;
        const request = (async () => {
            try {
                await cancelChatMessage(pending.conversationId, pending.assistantMessageId!, pending.userId);
                if (useUserStore.getState().user?.id !== pending.userId || useChatRuntimeStore.getState().turnId !== pending.turnId) return false;
                pending.stopped = true;
                pending.stopRequested = false;
                markPendingAssistantStopped(pending);
                if (pendingTurnRef.current === pending) {
                    abortRef.current?.abort();
                    abortRef.current = null;
                    pendingTurnRef.current = null;
                    sendingRef.current = false;
                    if (isCurrentPage(pending.userId)) setSending(false);
                }
                useChatRuntimeStore.getState().clearRuntime(pending.conversationId, pending.turnId);
                return true;
            } catch (error) {
                pending.stopRequested = false;
                const runtime = useChatRuntimeStore.getState();
                if (runtime.pending && runtime.turnId === pending.turnId) {
                    runtime.setRuntime({ status: pending.started ? "streaming" : "starting" });
                }
                if (isCurrentPage(pending.userId)) message.error("暂时无法停止，回答仍会继续");
                return false;
            } finally {
                pending.cancelRequest = undefined;
            }
        })();
        pending.cancelRequest = request;
        return request;
    }

    async function stopActiveTurn() {
        const pending = pendingTurnRef.current;
        if (pending && !pending.terminal) {
            pending.stopRequested = true;
            useChatRuntimeStore.getState().setRuntime({ pending: true, status: "stopping", conversationId: pending.conversationId });
            if (pending.assistantMessageId) await cancelPendingTurn(pending);
            return;
        }

        const runtime = useChatRuntimeStore.getState();
        if (runtime.pending && runtime.userId !== userId) return;
        const stopTurnId = runtime.turnId;
        const canUpdate = () => isCurrentPage(userId) && (!stopTurnId || useChatRuntimeStore.getState().turnId === stopTurnId);
        const conversationId = runtime.pending ? runtime.conversationId : activeConversationIdRef.current;
        if (!conversationId) return;
        const restoreStatus = runtime.pending && runtime.status === "starting" ? "starting" : "streaming";
        let assistant = conversationId === activeConversationIdRef.current ? messages.find((item) => item.role === "assistant" && item.status === "streaming") : undefined;
        try {
            let fetchedMessages: ChatMessage[] | undefined;
            if (!assistant) {
                let detail = await fetchChatConversation(conversationId, userId);
                if (!canUpdate()) return;
                fetchedMessages = detail.messages;
                assistant = detail.messages.find((item) => item.role === "assistant" && item.status === "streaming");
                for (let attempt = 0; !assistant && runtime.pending && attempt < 12; attempt += 1) {
                    const latestRuntime = useChatRuntimeStore.getState();
                    if (!latestRuntime.pending || latestRuntime.conversationId !== conversationId) break;
                    await new Promise((resolve) => window.setTimeout(resolve, 250));
                    detail = await fetchChatConversation(conversationId, userId);
                    if (!canUpdate()) return;
                    fetchedMessages = detail.messages;
                    assistant = detail.messages.find((item) => item.role === "assistant" && item.status === "streaming");
                }
            }
            if (!assistant) {
                const latestRuntime = useChatRuntimeStore.getState();
                if (latestRuntime.pending && latestRuntime.conversationId === conversationId) {
                    latestRuntime.setRuntime({ status: restoreStatus });
                    message.info("回答仍在启动，暂未取得可停止的消息标识；稍后可再次点击停止");
                } else {
                    latestRuntime.clearRuntime(conversationId, stopTurnId);
                    message.info("这段问道已结束，已刷新消息状态");
                }
                if (conversationId === activeConversationIdRef.current) {
                    const detail = await fetchChatConversation(conversationId, userId);
                    if (!canUpdate()) return;
                    setMessages(detail.messages);
                }
                return;
            }
            useChatRuntimeStore.getState().setRuntime({ pending: true, status: "stopping", conversationId });
            await cancelChatMessage(conversationId, assistant.id, userId);
            if (!canUpdate()) return;
            if (conversationId === activeConversationIdRef.current) {
                const stoppedAssistant = { ...assistant, status: "failed" as const, error: "本次回答已停止" };
                setMessages((current) => {
                    if (current.some((item) => item.id === assistant!.id)) {
                        return current.map((item) => (item.id === assistant!.id && item.status !== "completed" ? stoppedAssistant : item));
                    }
                    const latest = fetchedMessages?.find((item) => item.id === assistant!.id);
                    return latest ? [...current, stoppedAssistant].sort((left, right) => left.createdAt - right.createdAt) : current;
                });
            }
            useChatRuntimeStore.getState().clearRuntime(conversationId, stopTurnId);
        } catch (error) {
            if (!canUpdate()) return;
            const latestRuntime = useChatRuntimeStore.getState();
            if (latestRuntime.pending && latestRuntime.conversationId === conversationId) {
                latestRuntime.setRuntime({ status: restoreStatus });
            }
            message.error("暂时无法停止，回答仍会继续");
        }
    }

    async function selectConversation(id: string) {
        if (id === activeConversationIdRef.current) return;
        if (!(await confirmPendingNavigation("切换"))) return;
        shouldStickToBottomRef.current = true;
        activeConversationIdRef.current = id;
        setActiveConversationId(id);
        setMessages([]);
        setEditingDraft(null);
    }

    async function handleNewConversation() {
        if (!userId || creatingRef.current || sendStartingRef.current) return;
        if (!(await confirmPendingNavigation("新建"))) return;
        if (!isCurrentPage(userId) || creatingRef.current || sendStartingRef.current) return;
        creatingRef.current = true;
        setCreating(true);
        try {
            const response = await createChatConversation({ presetId }, userId);
            if (!isCurrentPage(userId)) return;
            clearChatBootstrapCache(userId);
            setConversations((current) => [response.conversation, ...current]);
            shouldStickToBottomRef.current = true;
            activeConversationIdRef.current = response.conversation.id;
            setActiveConversationId(response.conversation.id);
            setMessages([]);
            setEditingDraft(null);
        } catch (error) {
            if (isCurrentPage(userId)) message.error(userFacingErrorMessage(error, "新建问道失败"));
        } finally {
            if (isCurrentPage(userId)) {
                creatingRef.current = false;
                setCreating(false);
            }
        }
    }

    async function handleExportConversation() {
        if (!activeConversation) {
            message.info("请先打开一段问道");
            return;
        }
        try {
            const payload = await fetchChatConversationExport(activeConversation.id, userId);
            if (!isCurrentPage(userId)) return;
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `${safeChatFilename(payload.conversation.title)}.json`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 0);
            message.success("会话已导出");
        } catch (error) {
            if (isCurrentPage(userId)) message.error(userFacingErrorMessage(error, "会话暂时无法导出，请重试"));
        }
    }

    async function handleImportFile(files: FileList | null) {
        const file = files?.[0];
        if (importInputRef.current) importInputRef.current.value = "";
        if (!file) return;
        if (file.size > 512 * 1024) {
            message.error("会话文件过大，无法导入");
            return;
        }
        if (!(await confirmPendingNavigation("导入会话"))) return;
        setImporting(true);
        try {
            const payload = JSON.parse(await file.text()) as unknown;
            const response = await importChatConversation(payload, userId);
            clearChatBootstrapCache(userId);
            setConversations((current) => [response.conversation, ...current.filter((item) => item.id !== response.conversation.id)]);
            shouldStickToBottomRef.current = true;
            activeConversationIdRef.current = response.conversation.id;
            setActiveConversationId(response.conversation.id);
            setMessages(response.messages);
            setEditingDraft(null);
            message.success(response.skippedAttachmentCount ? `会话已导入，${response.skippedAttachmentCount} 张图片未恢复` : "会话已导入");
        } catch (error) {
            message.error(userFacingErrorMessage(error, "会话文件导入失败"));
        } finally {
            setImporting(false);
        }
    }

    async function ensureConversation() {
        if (activeConversationIdRef.current) return { conversationId: activeConversationIdRef.current, clearSubmittedDraft: ordinaryDraft.clearDraft };
        const response = await createChatConversation({ presetId }, userId);
        if (!isCurrentPage(userId)) return null;
        setConversations((current) => [response.conversation, ...current]);
        if (activeConversationIdRef.current) return null;
        const clearSubmittedDraft = ordinaryDraft.moveDraft(response.conversation.id);
        activeConversationIdRef.current = response.conversation.id;
        setActiveConversationId(response.conversation.id);
        return { conversationId: response.conversation.id, clearSubmittedDraft };
    }

    async function handleDeleteConversation(id: string) {
        const deletingActiveTurn = pendingTurnRef.current?.conversationId === id || (useChatRuntimeStore.getState().pending && useChatRuntimeStore.getState().conversationId === id);
        if (deletingActiveTurn) await stopActiveTurn();
        try {
            await deleteChatConversation(id, userId);
            clearChatBootstrapCache(userId);
            const next = conversations.filter((item) => item.id !== id);
            setConversations(next);
            if (activeConversationIdRef.current === id) {
                const nextId = next[0]?.id || "";
                shouldStickToBottomRef.current = true;
                activeConversationIdRef.current = nextId;
                setActiveConversationId(nextId);
                setMessages([]);
                setEditingDraft(null);
            }
        } catch (error) {
            message.error(userFacingErrorMessage(error, "删除失败"));
        }
    }

    async function handleUpload(files: FileList | null) {
        if (!ordinaryDraft.ready || !isCurrentPage(userId) || sendBlocked()) return;
        const selected = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        if (!selected.length) return;
        if (attachments.length + selected.length > 4) {
            message.warning("每次最多上传 4 张图片");
            return;
        }
        const uploadConversationId = activeConversationIdRef.current;
        const uploadSequence = ++uploadSequenceRef.current;
        uploadingRef.current = true;
        setUploading(true);
        try {
            const uploaded = await Promise.all(selected.map((file) => uploadChatImage(file, userId)));
            if (!isCurrentPage(userId) || uploadSequenceRef.current !== uploadSequence) return;
            if (activeConversationIdRef.current !== uploadConversationId) {
                message.warning("图片已上传，但你已切换问道会话；为避免附错会话，请在目标会话重新选择图片");
                return;
            }
            setAttachments((current) => [...current, ...uploaded]);
        } catch (error) {
            if (isCurrentPage(userId)) message.error(userFacingErrorMessage(error, "图片上传失败"));
        } finally {
            if (isCurrentPage(userId) && uploadSequenceRef.current === uploadSequence) {
                uploadingRef.current = false;
                setUploading(false);
                if (fileInputRef.current) fileInputRef.current.value = "";
            }
        }
    }

    function isCurrentPage(expectedUserId: string) {
        return mountedRef.current && pageUserIdRef.current === expectedUserId && useUserStore.getState().user?.id === expectedUserId;
    }

    function sendBlocked(includeStarting = true) {
        const runtime = useChatRuntimeStore.getState();
        return isChatSendBlocked({
            uploading: uploadingRef.current,
            starting: includeStarting && sendStartingRef.current,
            sending: sendingRef.current,
            pending: Boolean(pendingTurnRef.current),
            runtimePending: runtime.pending && runtime.userId === userId,
            hasStreamingMessage: messagesRef.current.some((item) => item.status === "streaming"),
            creating: creatingRef.current,
        });
    }

    async function runChatTurn(input: ChatTurnInput) {
        if (!isCurrentPage(userId) || sendBlocked(false)) return;
        sendingRef.current = true;
        const createdAt = Date.now();
        const snapshot = messagesRef.current.filter((item) => item.conversationId === input.conversationId);
        const targetId = input.editUserMessageId || input.retryAssistantMessageId || input.continueAssistantMessageId;
        const targetIndex = snapshot.findIndex((item) => item.id === targetId);
        const previousAssistant = input.editUserMessageId ? snapshot[targetIndex + 1] : snapshot[targetIndex];
        const optimisticUserId = input.clientMessageId || `optimistic-user-${createdAt}-${nanoid()}`;
        const pending: PendingChatTurn = {
            conversationId: input.conversationId,
            optimisticUserId,
            optimisticAssistantId: input.optimisticAssistantId || `optimistic-assistant-${nanoid()}`,
            createdAt: snapshot.find((item) => item.id === optimisticUserId)?.createdAt || createdAt,
            started: false,
            stopped: false,
            stopRequested: false,
            terminal: false,
            retryAssistantMessageId: input.retryAssistantMessageId,
            editUserMessageId: input.editUserMessageId,
            continueAssistantMessageId: input.continueAssistantMessageId,
            previousAssistant: previousAssistant?.role === "assistant" ? previousAssistant : undefined,
            referenceUserMessageId: input.showOptimisticUser ? optimisticUserId : input.editUserMessageId || snapshot.slice(0, targetIndex).findLast((item) => item.role === "user")?.id || "",
            userId,
            turnId: nanoid(),
        };
        pendingTurnRef.current = pending;
        const controller = new AbortController();
        abortRef.current = controller;
        const unsubscribeUser = useUserStore.subscribe((state) => {
            if (state.user?.id === pending.userId) return;
            controller.abort();
            useChatRuntimeStore.getState().clearRuntime(pending.conversationId, pending.turnId);
        });
        setSending(true);
        clearChatBootstrapCache(userId);
        shouldStickToBottomRef.current = true;
        useChatRuntimeStore.getState().setRuntime({ pending: true, status: "starting", conversationId: input.conversationId, startedAt: createdAt, userId, turnId: pending.turnId });
        const ownsRuntime = () => useUserStore.getState().user?.id === pending.userId && useChatRuntimeStore.getState().turnId === pending.turnId;
        const visible = () => isCurrentPage(pending.userId) && activeConversationIdRef.current === pending.conversationId;
        if (input.showOptimisticUser && visible()) {
            setMessages((current) => [
                ...current.filter((item) => item.id !== pending.optimisticAssistantId),
                ...(current.some((item) => item.id === optimisticUserId) ? [] : [createOptimisticUserMessage(pending, input.content, input.attachments)]),
            ]);
        }
        const acceptTurn = ({ conversation, userMessage, assistantMessage }: ChatStartedEvent, recovering = false) => {
            if (!ownsRuntime()) return;
            const firstStarted = !pending.started;
            pending.started = true;
            pending.userMessageId = userMessage.id;
            pending.assistantMessageId = assistantMessage.id;
            failedTurnsRef.current.delete(pending.optimisticAssistantId);
            const runtime = useChatRuntimeStore.getState();
            if (runtime.status === "stopping") pending.stopRequested = true;
            runtime.setRuntime({ status: pending.stopRequested ? "stopping" : recovering ? "recovering" : "streaming" });
            if (pending.stopRequested) void cancelPendingTurn(pending);
            if (!isCurrentPage(pending.userId)) return;
            setConversations((current) => upsertConversation(current, conversation));
            if (firstStarted) input.clearSubmittedDraft?.();
            if (!visible()) return;
            setMessages((current) => mergeStartedChatMessages(current, pending, userMessage, assistantMessage, input.showOptimisticUser, pending.stopped, input.editUserMessageId));
        };
        const readTurn = async () => {
            const { turn } = await fetchChatTurn(input.conversationId, pending.optimisticUserId, pending.userId);
            if (turn) pending.operationAccepted = true;
            return turn;
        };
        const recover = () => {
            if (ownsRuntime()) useChatRuntimeStore.getState().setRuntime({ status: pending.stopRequested ? "stopping" : "recovering" });
            return recoverChatTurn({
                read: readTurn,
                pending,
                isCurrent: () => ownsRuntime() && !pending.stopped,
                onUpdate: (turn) => {
                    acceptTurn(turn, true);
                    pending.terminal = turn.assistantMessage.status !== "streaming";
                },
            });
        };
        const failBeforeStarted = (error: unknown, unknownOutcome: boolean) => {
            if (!ownsRuntime()) return;
            const errorText = unknownOutcome ? "暂未确认这次问题是否送达，请重试；系统会先查询已有结果。" : error instanceof Error ? error.message : "问道台暂未回应";
            if (input.showOptimisticUser) {
                failedTurnsRef.current.set(pending.optimisticAssistantId, {
                    ...input, clientMessageId: optimisticUserId, optimisticAssistantId: pending.optimisticAssistantId, reconcileBeforeSend: true,
                });
                if (visible()) setMessages((current) => [...current.filter((item) => item.id !== pending.optimisticAssistantId), createOptimisticAssistantMessage(pending, errorText)]);
            }
            if (isCurrentPage(pending.userId)) message.error(unknownOutcome && !input.showOptimisticUser ? "暂未确认本次操作结果，已保留原有消息；请查看对话后再试。" : userFacingErrorMessage(errorText, "这次回答暂未开始，可以重试。"));
        };
        try {
            if (input.reconcileBeforeSend) {
                // Reuse the same client id on resubmit; the server treats it idempotently.
                const result = await recover();
                if (result !== "missing" || !ownsRuntime()) return;
                useChatRuntimeStore.getState().setRuntime({ status: "starting" });
            }
            await sendChatMessage({
                conversationId: input.conversationId,
                content: input.content,
                attachments: input.attachments,
                clientMessageId: optimisticUserId,
                ...(input.retryAssistantMessageId ? { retryAssistantMessageId: input.retryAssistantMessageId } : {}),
                ...(input.editUserMessageId ? { editUserMessageId: input.editUserMessageId } : {}),
                ...(input.continueAssistantMessageId ? { continueAssistantMessageId: input.continueAssistantMessageId } : {}),
                ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
                expectedUserId: pending.userId,
                signal: controller.signal,
                onStarted: (turn) => acceptTurn(turn),
                onDelta: ({ messageId, delta }) => {
                    if (!ownsRuntime() || pending.stopped || !visible()) return;
                    setMessages((current) => current.map((item) => (item.id === messageId ? { ...item, content: item.content + delta } : item)));
                },
                onDone: ({ conversation, message: doneMessage }) => {
                    pending.terminal = true;
                    if (!ownsRuntime() || !isCurrentPage(pending.userId)) return;
                    setConversations((current) => upsertConversation(current, conversation));
                    if (!visible()) return;
                    setMessages((current) => (current.some((item) => item.id === doneMessage.id) ? current.map((item) => (item.id === doneMessage.id ? doneMessage : item)) : [...current, doneMessage]));
                },
                onError: ({ message: errorMessage, messageId }) => {
                    pending.terminal = true;
                    if (!ownsRuntime() || !isCurrentPage(pending.userId)) return;
                    if (visible()) {
                        const failedMessageId = messageId || pending.assistantMessageId || pending.optimisticAssistantId;
                        setMessages((current) => current.some((item) => item.id === failedMessageId)
                            ? current.map((item) => (item.id === failedMessageId ? { ...item, status: "failed", error: pending.stopped ? "本次回答已停止" : errorMessage } : item))
                            : [...current, createOptimisticAssistantMessage(pending, pending.stopped ? "本次回答已停止" : errorMessage)]);
                    }
                    if (!pending.stopped) message.error(userFacingErrorMessage(errorMessage, "这次回答暂未完成，请查看对话后再试"));
                },
            });
        } catch (error) {
            if (!ownsRuntime() || pending.stopped || pending.terminal) return;
            if (!pending.started && error instanceof ChatRequestError && error.rejected) {
                // Setup can fail after the server persisted the turn but before
                // it emitted started. Prefer that persisted failure for retry.
                try {
                    const turn = await readTurn();
                    if (!ownsRuntime()) return;
                    if (turn && isAcceptedChatTurn(turn, pending)) {
                        acceptTurn(turn, true);
                        if (turn.assistantMessage.status === "streaming") await recover();
                        else pending.terminal = true;
                        return;
                    }
                } catch { /* The explicit rejection still provides a retryable failure. */ }
                failBeforeStarted(error, false);
            } else {
                const result = await recover();
                if (result === "missing") failBeforeStarted(error, true);
            }
        } finally {
            unsubscribeUser();
            if (pendingTurnRef.current === pending) {
                pendingTurnRef.current = null;
                sendingRef.current = false;
                if (abortRef.current === controller) abortRef.current = null;
                if (isCurrentPage(pending.userId)) setSending(false);
            }
            clearChatBootstrapCache(pending.userId);
            useChatRuntimeStore.getState().clearRuntime(input.conversationId, pending.turnId);
        }
    }
    async function handleSend() {
        const content = draft.trim();
        if (!ordinaryDraft.ready || (!content && !attachments.length) || !isCurrentPage(userId) || sendBlocked()) return;
        sendStartingRef.current = true;
        const sendStartSequence = ++sendStartSequenceRef.current;
        try {
            const ensured = await ensureConversation();
            if (!ensured) return;
            const { conversationId } = ensured;
            if (!conversationId || !isCurrentPage(userId) || activeConversationIdRef.current !== conversationId || sendBlocked(false)) return;
            const clearSubmittedDraft = editing ? () => setEditingDraft((current) => current === editing ? null : current) : ensured.clearSubmittedDraft;
            const turn = runChatTurn({ conversationId, content, attachments, canvasContext: canvasContext || undefined, editUserMessageId: editingMessageId || undefined, showOptimisticUser: !editingMessageId, clearSubmittedDraft });
            sendStartingRef.current = false;
            await turn;
        } catch (error) {
            if (isCurrentPage(userId)) message.error(userFacingErrorMessage(error, "问道台暂未回应"));
        } finally {
            if (isCurrentPage(userId) && sendStartSequenceRef.current === sendStartSequence) sendStartingRef.current = false;
        }
    }

    async function handleRetry(item: ChatMessage) {
        if (item.role !== "assistant" || !["failed", "completed"].includes(item.status)) return;
        if (sendBlocked()) {
            message.info("请等待当前回答结束");
            return;
        }
        if (item.isOptimistic) {
            const failed = failedTurnsRef.current.get(item.id);
            if (failed) await runChatTurn(failed);
            return;
        }
        await runChatTurn({
            conversationId: item.conversationId,
            content: "",
            attachments: [],
            retryAssistantMessageId: item.id,
            showOptimisticUser: false,
        });
    }

    async function handleContinue(item: ChatMessage) {
        if (item.role !== "assistant" || item.status !== "completed" || item.isOptimistic) return;
        if (sendBlocked()) {
            message.info("请等待当前回答结束");
            return;
        }
        await runChatTurn({
            conversationId: item.conversationId,
            content: "",
            attachments: [],
            continueAssistantMessageId: item.id,
            showOptimisticUser: false,
        });
    }

    function handleEdit(item: ChatMessage) {
        if (item.role !== "user" || item.status !== "completed" || item.isOptimistic || sendBlocked()) return;
        setEditingDraft({ id: nanoid(), userId, conversationId: item.conversationId, messageId: item.id, draft: item.content, attachments: item.attachments });
    }

    function cancelEdit() {
        setEditingDraft(null);
    }

    async function handleDeleteMessage(item: ChatMessage) {
        if (item.isOptimistic) return;
        if (pendingTurnRef.current?.conversationId === item.conversationId && !(await confirmPendingNavigation("删除"))) return;
        const confirmed = await new Promise<boolean>((resolve) => {
            modal.confirm({
                title: "回退问道内容",
                content: "将删除这条消息及其后的所有内容，已经生成的回答也会一起移除。是否继续？",
                okText: "删除并回退",
                cancelText: "暂不删除",
                okButtonProps: { danger: true },
                onOk: () => resolve(true),
                onCancel: () => resolve(false),
            });
        });
        if (!confirmed) return;
        try {
            const response = await truncateChatMessages(item.conversationId, item.id, userId);
            const lastMessage = response.messages[response.messages.length - 1];
            setConversations((current) => upsertConversation(current, { ...response.conversation, lastMessage: lastMessage?.content.slice(0, 120) || "" }));
            if (activeConversationIdRef.current === item.conversationId) setMessages(response.messages);
            if (editingMessageId && (editingMessageId === item.id || !response.messages.some((message) => message.id === editingMessageId))) cancelEdit();
        } catch (error) {
            message.error(userFacingErrorMessage(error, "消息删除失败"));
        }
    }

    function handleStop() {
        void stopActiveTurn();
    }

    async function handlePresetChange(nextPresetId: ChatPresetId) {
        if (nextPresetId === activePresetId) return;
        if (activeConversation) {
            const confirmed = await new Promise<boolean>((resolve) => {
                modal.confirm({
                    title: "切换问道角色",
                    content: "新角色只对后续消息生效，历史回答不会改写。是否切换？",
                    okText: "确认切换",
                    cancelText: "暂不切换",
                    onOk: () => resolve(true),
                    onCancel: () => resolve(false),
                });
            });
            if (!confirmed) return;
            try {
                const response = await updateChatConversationPreset(activeConversation.id, nextPresetId, userId);
                setConversations((current) => upsertConversation(current, response.conversation));
                setPresetDefault(nextPresetId);
            } catch (error) {
                message.error(userFacingErrorMessage(error, "问道角色切换失败"));
            }
            return;
        }
        setPresetDefault(nextPresetId);
    }

    function setPresetDefault(nextPresetId: ChatPresetId) {
        presetIdRef.current = nextPresetId;
        presetEditedDuringHydration.current = true;
        setPresetId(nextPresetId);
        writeLocalChatPreset(userId, nextPresetId);
        if (presetReadyUser !== userId || !userId) return;
        enqueuePresetSave(nextPresetId, userId);
    }

    function enqueuePresetSave(nextPresetId: ChatPresetId, expectedUserId: string, isActive = () => true) {
        presetSaveQueue.current = presetSaveQueue.current
            .catch(() => undefined)
            .then(async () => {
                if (!isActive() || useUserStore.getState().user?.id !== expectedUserId) return;
                try {
                    await saveServerUserPreferences({ chatPresetId: nextPresetId }, expectedUserId);
                } catch (error) {
                    if (isActive() && useUserStore.getState().user?.id === expectedUserId) {
                        message.error(userFacingErrorMessage(error, "问道角色保存失败"));
                    }
                }
            });
    }

    async function handleSavePersona() {
        if (!userId || personaSaving) return;
        setPersonaSaving(true);
        try {
            const nextPersona = personaDraft.trim();
            const response = await saveServerUserPreferences({ chatPersona: nextPersona }, userId);
            const savedPersona = response.chatPersona || nextPersona;
            setChatPersona(savedPersona);
            setPersonaDraft(savedPersona);
            message.success(savedPersona ? "用户身份已保存" : "用户身份已清除");
        } catch (error) {
            message.error(userFacingErrorMessage(error, "用户身份保存失败"));
        } finally {
            setPersonaSaving(false);
        }
    }

    async function handleSaveMemory() {
        const content = memoryDraft.trim();
        if (!content || memorySaving) return;
        setMemorySaving(true);
        try {
            if (editingMemoryId) {
                const response = await updateChatMemory(editingMemoryId, { content }, userId);
                setMemories((current) => current.map((item) => (item.id === editingMemoryId ? response.memory : item)));
                message.success("记忆已更新");
            } else {
                const response = await createChatMemory({ kind: "fact", content, pinned: true }, userId);
                setMemories((current) => [response.memory, ...current]);
                message.success("记忆已保存");
            }
            setMemoryDraft("");
            setEditingMemoryId("");
        } catch (error) {
            message.error(userFacingErrorMessage(error, "记忆保存失败"));
        } finally {
            setMemorySaving(false);
        }
    }

    async function handleRememberMessage(item: ChatMessage) {
        const content = item.content.trim();
        if (!content || item.status !== "completed") return;
        if (memories.some((memory) => memory.content.trim() === content)) {
            message.info("这段内容已经在长期记忆中");
            return;
        }
        try {
            const response = await createChatMemory({ kind: "fact", content: content.slice(0, 4_000), sourceConversationId: item.conversationId, pinned: true }, userId);
            setMemories((current) => [response.memory, ...current]);
            message.success("已加入长期记忆");
        } catch (error) {
            message.error(userFacingErrorMessage(error, "保存长期记忆失败"));
        }
    }

    async function handleDeleteMemory(id: string) {
        try {
            await deleteChatMemory(id, userId);
            setMemories((current) => current.filter((item) => item.id !== id));
            if (editingMemoryId === id) {
                setEditingMemoryId("");
                setMemoryDraft("");
            }
        } catch (error) {
            message.error(userFacingErrorMessage(error, "记忆删除失败"));
        }
    }

    const messageActions = useRef({ retry: handleRetry, continue: handleContinue, edit: handleEdit, delete: handleDeleteMessage, remember: handleRememberMessage });
    useLayoutEffect(() => {
        messageActions.current = { retry: handleRetry, continue: handleContinue, edit: handleEdit, delete: handleDeleteMessage, remember: handleRememberMessage };
    });
    const handleMessageAction = useCallback((action: ChatMessageAction, item: ChatMessage) => {
        void messageActions.current[action](item);
    }, []);

    const conversationList = (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
            {!loading && !conversations.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无问道记录" /> : null}
            {conversations.map((conversation) => (
                <button
                    key={conversation.id}
                    type="button"
                    aria-current={conversation.id === activeConversationId ? "true" : undefined}
                    className={cn(
                        "group flex min-h-14 w-full min-w-0 items-start gap-2 rounded-lg border px-3 py-2 text-left transition",
                        conversation.id === activeConversationId
                            ? "border-amber-400/70 bg-amber-50/80 text-stone-950 dark:border-amber-300/35 dark:bg-amber-300/10 dark:text-[#fff8e8]"
                            : "border-transparent hover:border-stone-200 hover:bg-white/80 dark:hover:border-white/10 dark:hover:bg-white/[0.06]",
                    )}
                    onClick={() => { setConversationsOpen(false); void selectConversation(conversation.id); }}
                >
                    <MessageCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{conversation.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-stone-500 dark:text-stone-400">{conversation.lastMessage || "新的问道"}</span>
                    </span>
                    <Popconfirm
                        title="删除这段问道？"
                        okText="删除"
                        cancelText="取消"
                        onConfirm={(event) => {
                            event?.stopPropagation();
                            void handleDeleteConversation(conversation.id);
                        }}
                    >
                        <span className="rounded p-1 text-stone-400 opacity-0 transition hover:bg-stone-100 hover:text-red-500 group-hover:opacity-100 max-lg:opacity-100 dark:hover:bg-white/10" onClick={(event) => event.stopPropagation()}>
                            <Trash2 className="size-3.5" />
                        </span>
                    </Popconfirm>
                </button>
            ))}
        </div>
    );

    if (mode === "douqi") {
        return (
            <Suspense
                fallback={
                    <div className="grid h-full place-items-center bg-[#f7f5ef] text-sm text-stone-500 dark:bg-[#11100e] dark:text-stone-400">
                        <span className="inline-flex items-center gap-2">
                            <LoaderCircle className="size-4 animate-spin" />
                            正在开启斗气人生...
                        </span>
                    </div>
                }
            >
                <DouQiLifeView onExit={() => setMode("chat")} />
            </Suspense>
        );
    }

    return (
        <div className="chat-page h-full overflow-hidden bg-[#f7f5ef] text-stone-900 dark:bg-[#11100e] dark:text-[#f5efe3]">
            <picture className="chat-scene" aria-hidden="true">
                <source media="(max-width: 1023px)" srcSet="/images/chat-mountain-study-v1-small.webp" />
                <img src="/images/chat-mountain-study-v1.webp" alt="" width={1774} height={887} loading="eager" decoding="async" />
            </picture>
            <input ref={importInputRef} type="file" accept=".json,application/json" className="hidden" onChange={(event) => void handleImportFile(event.target.files)} />
            <div className="chat-layout mx-auto grid h-full max-w-[1480px] grid-cols-[280px_minmax(0,1fr)] gap-0 px-4 py-4 max-lg:grid-cols-1 max-lg:px-3">
                <aside className="flex min-h-0 flex-col border-r border-stone-200/80 pr-4 max-lg:hidden dark:border-white/10">
                    <div className="mb-4 flex items-center justify-between gap-2">
                        <div>
                            <div className="text-lg font-semibold tracking-[0.18em]">问道台</div>
                            <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">站内 AI 对话</div>
                        </div>
                        <Tooltip title="新建问道">
                            <Button shape="circle" type="text" icon={<Plus className="size-4" />} loading={creating} onClick={handleNewConversation} />
                        </Tooltip>
                    </div>
                    {conversationList}
                </aside>

                <main className="flex min-h-0 min-w-0 flex-col pl-4 max-lg:pl-0">
                    <div className="mb-3 flex shrink-0 flex-col gap-2 border-b border-stone-200/80 pb-3 dark:border-white/10 lg:flex-row lg:items-center lg:justify-between lg:gap-3">
                        <div className="flex min-w-0 items-center justify-between gap-2 lg:flex-1">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="shrink-0 whitespace-nowrap text-base font-semibold tracking-[0.12em]">问道台</span>
                                    <Tag color="gold" bordered={false} className="!m-0 max-w-[120px] truncate max-sm:!hidden">
                                        {activePreset.label}
                                    </Tag>
                                </div>
                                <div className="mt-1 truncate text-xs text-stone-500 dark:text-stone-400">{activeConversation?.title || activePreset.description}</div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2 lg:hidden">
                                <Button type="text" className="!h-11 !w-11 !min-w-11 !p-0" icon={<MessageCircle className="size-4" />} aria-label="问道记录" aria-expanded={conversationsOpen} onClick={() => setConversationsOpen(true)} />
                                <Button className="!h-11 !px-3" icon={<Plus className="size-4" />} onClick={handleNewConversation} loading={creating}>
                                    新建
                                </Button>
                            </div>
                        </div>
                        <div className="flex min-w-0 items-center justify-between gap-2 lg:justify-end">
                            <Segmented
                                size="small"
                                className="max-lg:[&_.ant-segmented-item-label]:!min-h-11 max-lg:[&_.ant-segmented-item-label]:!leading-[44px]"
                                value={mode}
                                options={[{ label: "普通问道", value: "chat" }, { label: "斗气人生", value: "douqi" }]}
                                onChange={(value) => setMode(value as ChatMode)}
                            />
                            <div className="hidden items-center gap-2 lg:flex">
                                <Tooltip title="导出当前会话">
                                    <Button
                                        type="text"
                                        className="!h-8 !w-8 !min-w-8 !p-0"
                                        icon={<Download className="size-4" />}
                                        aria-label="导出当前会话"
                                        disabled={!activeConversation || detailLoading || importing}
                                        onClick={handleExportConversation}
                                    />
                                </Tooltip>
                                <Tooltip title="导入会话">
                                    <Button
                                        type="text"
                                        className="!h-8 !w-8 !min-w-8 !p-0"
                                        icon={importing ? <LoaderCircle className="size-4 animate-spin" /> : <FileUp className="size-4" />}
                                        aria-label="导入会话"
                                        disabled={turnRunning || importing}
                                        onClick={() => importInputRef.current?.click()}
                                    />
                                </Tooltip>
                                <Tooltip title="查看角色卡与用户身份">
                                    <Button
                                        type="text"
                                        className="!h-8 !w-8 !min-w-8 !p-0"
                                        icon={<BookOpen className="size-4" />}
                                        aria-label="查看角色卡与用户身份"
                                        onClick={() => setProfileOpen(true)}
                                    />
                                </Tooltip>
                                <Tooltip title="查看长期记忆">
                                    <Button
                                        type="text"
                                        className="!h-8 !w-8 !min-w-8 !p-0"
                                        icon={<Brain className="size-4" />}
                                        aria-label="查看长期记忆"
                                        onClick={() => setMemoryOpen(true)}
                                    />
                                </Tooltip>
                            </div>
                            <Dropdown
                                trigger={["click"]}
                                menu={{
                                    items: [
                                        { key: "export", label: "导出当前会话", icon: <Download className="size-4" />, disabled: !activeConversation || detailLoading || importing },
                                        { key: "import", label: "导入会话", icon: <FileUp className="size-4" />, disabled: turnRunning || importing },
                                        { key: "profile", label: "查看角色卡与用户身份", icon: <BookOpen className="size-4" /> },
                                        { key: "memory", label: "查看长期记忆", icon: <Brain className="size-4" /> },
                                    ],
                                    onClick: ({ key }) => {
                                        if (key === "export") handleExportConversation();
                                        if (key === "import") importInputRef.current?.click();
                                        if (key === "profile") setProfileOpen(true);
                                        if (key === "memory") setMemoryOpen(true);
                                    },
                                }}
                            >
                                <Button type="text" className="!h-11 shrink-0 !px-3 lg:!hidden" icon={<MoreHorizontal className="size-4" />}>
                                    更多
                                </Button>
                            </Dropdown>
                        </div>
                    </div>

                    <div ref={scrollRef} onScroll={handleChatScroll} className="min-h-0 flex-1 overflow-y-auto px-1 py-3 sm:px-4">
                        {historyPage.hasMore ? <div className="mb-3 text-center"><Button type="text" size="small" loading={historyLoading} disabled={detailLoading} onClick={() => void loadEarlierMessages()}>加载更早的对话</Button></div> : null}
                        {detailLoading ? <Skeleton active paragraph={{ rows: 8 }} /> : null}
                        {!detailLoading && !messages.length ? <WelcomeEmpty preset={activePreset} /> : null}
                        <div className="space-y-6">
                            {messages.map((item, index) => (
                                <ChatBubble key={item.id} item={item} isLatest={index === messages.length - 1} onAction={handleMessageAction} />
                            ))}
                            {turnRunning ? (
                                <div className="flex items-center gap-2 text-xs text-stone-500">
                                    <LoaderCircle className="size-3.5 animate-spin" />
                                    {runtimeConversationId && runtimeConversationId !== activeConversationId
                                        ? "另一段问道正在后台回应..."
                                        : runtimeStatus === "stopping"
                                          ? "正在停止当前回答..."
                                          : runtimeStatus === "recovering"
                                            ? "连接暂时中断，正在恢复回答..."
                                          : "天地法则正在回应..."}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className="mt-3 shrink-0 rounded-xl border border-stone-200/80 bg-white/85 p-3 shadow-sm dark:border-white/10 dark:bg-[#171512]">
                        {canvasContext ? (
                            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-sky-200/70 bg-sky-50/70 px-3 py-2 text-xs text-sky-800 dark:border-sky-300/15 dark:bg-sky-300/[0.06] dark:text-sky-100">
                                <span className="min-w-0 truncate">已附加画布上下文：{canvasContext.projectTitle} · {canvasContext.nodes.length} 个节点</span>
                                <Button type="text" size="small" className="shrink-0 !px-1.5" onClick={clearCanvasContext}>移除</Button>
                            </div>
                        ) : null}
                        {editingMessageId ? (
                            <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-300/15 dark:bg-amber-300/[0.06] dark:text-amber-100">
                                <span className="inline-flex min-w-0 items-center gap-2 truncate">
                                    <Pencil className="size-3.5 shrink-0" />
                                    正在编辑这条问题，发送后会从这里重新生成回答
                                </span>
                                <Button type="text" size="small" className="shrink-0 !px-1.5" onClick={cancelEdit}>
                                    取消编辑
                                </Button>
                            </div>
                        ) : null}
                        {attachments.length ? (
                            <div className="mb-3 flex flex-wrap gap-2">
                                {attachments.map((attachment) => (
                                    <div key={attachment.assetKey} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-stone-200 bg-stone-50 dark:border-white/10 dark:bg-white/5">
                                        {attachment.url ? <img src={attachment.url} alt={attachment.name} className="h-full w-full object-cover" /> : null}
                                        <button
                                            type="button"
                                            className="absolute right-0 top-0 grid size-11 place-items-center rounded-full bg-black/55 text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-white sm:size-8 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100"
                                            onClick={() => setAttachments((current) => current.filter((item) => item.assetKey !== attachment.assetKey))}
                                            aria-label="移除图片"
                                        >
                                            <X className="size-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                        <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-end gap-2 sm:flex">
                            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => void handleUpload(event.target.files)} />
                            <Input.TextArea
                                value={draft}
                                aria-label="问道内容"
                                className="col-span-3 row-start-1 !w-full !min-w-0 !text-base !leading-7 sm:order-3 sm:flex-1"
                                onChange={(event) => setDraft(event.target.value)}
                                autoSize={{ minRows: 1, maxRows: 6 }}
                                maxLength={20_000}
                                placeholder={`以「${activePreset.label}」向问道台提问...`}
                                onPressEnter={(event) => {
                                    if (event.shiftKey) return;
                                    event.preventDefault();
                                    void handleSend();
                                }}
                                disabled={turnRunning || !ordinaryDraft.ready}
                            />
                            <Tooltip title="上传图片提问">
                                <Button
                                    type="text"
                                    className="col-start-1 row-start-2 !h-11 !w-11 !min-w-11 sm:order-1 sm:!h-10 sm:!w-10 sm:!min-w-10"
                                    icon={uploading ? <LoaderCircle className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                                    aria-label="上传图片提问"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={turnRunning || uploading || !ordinaryDraft.ready}
                                />
                            </Tooltip>
                            <Dropdown
                                trigger={["click"]}
                                placement="topLeft"
                                disabled={turnRunning}
                                menu={{
                                    selectedKeys: [activePresetId],
                                    onClick: ({ key }) => void handlePresetChange(key as ChatPresetId),
                                    items: chatPresetOptions.map((preset) => ({
                                        key: preset.id,
                                        label: (
                                            <div className="min-w-[180px] py-0.5">
                                                <div className="text-sm font-medium">{preset.label}</div>
                                                <div className="mt-0.5 max-w-[240px] truncate text-xs text-stone-500">{preset.description}</div>
                                            </div>
                                        ),
                                    })),
                                }}
                            >
                                <Button type="text" className="col-start-2 row-start-2 !h-11 min-w-0 max-w-full justify-self-start !px-2 text-stone-600 dark:text-stone-200 sm:order-2 sm:!h-10 sm:shrink-0 sm:!px-2.5" icon={<Sparkles className="size-4 text-amber-600" />} disabled={turnRunning} title={activePreset.hint}>
                                    <span className="inline-flex max-w-[92px] items-center gap-1 truncate text-xs">
                                        <span className="truncate">{activePreset.label}</span>
                                        <ChevronDown className="size-3 shrink-0" />
                                    </span>
                                </Button>
                            </Dropdown>
                            {turnRunning ? (
                                <Button className="col-start-3 row-start-2 !h-11 shrink-0 sm:order-4 sm:!h-10" onClick={handleStop} disabled={runtimeStatus === "stopping"}>
                                    {runtimeStatus === "stopping" ? "正在停止" : "停止"}
                                </Button>
                            ) : (
                                <Button type="primary" className="col-start-3 row-start-2 !h-11 shrink-0 sm:order-4 sm:!h-10" icon={<Send className="size-4" />} disabled={!canSend} onClick={() => void handleSend()}>
                                    {editingMessageId ? "保存并重答" : "发送"}
                                </Button>
                            )}
                        </div>
                    </div>
                </main>
            </div>
            <Drawer title="问道记录" placement="left" open={conversationsOpen} width="min(340px, 100vw)" onClose={() => setConversationsOpen(false)} styles={{ body: { display: "flex", flexDirection: "column", padding: 16 } }}>
                {conversationList}
            </Drawer>
            <Drawer
                title={
                    <div className="flex items-center gap-2">
                        <span>{activePreset.label}</span>
                        <Tag color="gold" bordered={false}>
                            角色卡
                        </Tag>
                    </div>
                }
                open={profileOpen}
                width="min(420px, 100vw)"
                onClose={() => setProfileOpen(false)}
                styles={{ body: { padding: 20 } }}
            >
                <div className="space-y-5">
                    <div className="flex items-start gap-3">
                        <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-amber-300/50 bg-amber-100/60 text-lg font-semibold text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/10 dark:text-amber-200">
                            {activePreset.avatar ? <img src={activePreset.avatar} alt="" className="size-full object-cover" /> : activePreset.label.slice(0, 1)}
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 text-base font-semibold">
                                <UserRound className="size-4 text-amber-600" />
                                {activePreset.label}
                            </div>
                            <p className="mt-1 text-sm leading-6 text-stone-500 dark:text-stone-400">{activePreset.description}</p>
                        </div>
                    </div>

                    <div>
                        <div className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-stone-500 dark:text-stone-400">角色标签</div>
                        <div className="flex flex-wrap gap-2">
                            {activePreset.tags.map((tag) => (
                                <Tag key={tag}>{tag}</Tag>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-lg border border-amber-200/70 bg-amber-50/70 p-3 text-sm leading-6 text-stone-700 dark:border-amber-300/15 dark:bg-amber-300/[0.06] dark:text-stone-200">
                        <div className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-200">初次问候</div>
                        {activePreset.greeting}
                    </div>

                    <div>
                        <div className="mb-1 text-sm font-semibold">用户身份</div>
                        <div className="mb-2 text-xs leading-5 text-stone-500 dark:text-stone-400">告诉问道台你的背景、偏好或长期目标。它只作为回答参考，不会覆盖角色设定与安全边界。</div>
                        <Input.TextArea
                            value={personaDraft}
                            onChange={(event) => setPersonaDraft(event.target.value)}
                            maxLength={2000}
                            showCount
                            autoSize={{ minRows: 5, maxRows: 10 }}
                            placeholder="例如：我是独立产品设计师，偏好直接、具体、可执行的建议。"
                        />
                        <div className="mt-2 flex items-center justify-between gap-3">
                            <span className="text-xs text-stone-400">{chatPersona ? "已保存到当前账户" : "尚未设置"}</span>
                            <Button type="primary" loading={personaSaving} onClick={() => void handleSavePersona()}>
                                保存用户身份
                            </Button>
                        </div>
                    </div>
                </div>
            </Drawer>
            <Drawer
                title={
                    <div className="flex items-center gap-2">
                        <Brain className="size-4 text-amber-600" />
                        <span>长期记忆</span>
                        <Tag bordered={false}>{memories.length}</Tag>
                    </div>
                }
                open={memoryOpen}
                width="min(460px, 100vw)"
                onClose={() => setMemoryOpen(false)}
                styles={{ body: { padding: 20 } }}
            >
                <div className="space-y-4">
                    <div className="rounded-lg border border-amber-200/70 bg-amber-50/70 p-3 text-xs leading-5 text-stone-600 dark:border-amber-300/15 dark:bg-amber-300/[0.06] dark:text-stone-300">
                        这里保存的是跨会话的背景信息。系统会把近期问道摘要作为参考；你手动保存的内容优先级更高，但不会覆盖本轮要求。
                    </div>
                    <div className="flex items-end gap-2">
                        <Input.TextArea
                            value={memoryDraft}
                            onChange={(event) => setMemoryDraft(event.target.value)}
                            autoSize={{ minRows: 2, maxRows: 5 }}
                            maxLength={4000}
                            placeholder="例如：我偏好直接、具体、可执行的技术方案。"
                        />
                        <Button type="primary" loading={memorySaving} disabled={!memoryDraft.trim()} onClick={() => void handleSaveMemory()}>
                            {editingMemoryId ? "更新" : "记住"}
                        </Button>
                    </div>
                    {editingMemoryId ? (
                        <Button type="link" size="small" onClick={() => { setEditingMemoryId(""); setMemoryDraft(""); }}>
                            取消编辑
                        </Button>
                    ) : null}
                    <div className="space-y-2">
                        {memories.map((memory) => (
                            <div key={memory.id} className="rounded-lg border border-stone-200/80 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.04]">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                    <Tag color={memory.pinned ? "gold" : "default"}>{memoryKindLabel(memory.kind)}{memory.pinned ? " · 已固定" : ""}</Tag>
                                    <div className="flex items-center gap-1">
                                        <Button type="text" size="small" icon={<Pencil className="size-3.5" />} aria-label="编辑记忆" onClick={() => { setEditingMemoryId(memory.id); setMemoryDraft(memory.content); }} />
                                        <Popconfirm title="删除这条记忆？" okText="删除" cancelText="取消" onConfirm={() => void handleDeleteMemory(memory.id)}>
                                            <Button type="text" danger size="small" icon={<Trash2 className="size-3.5" />} aria-label="删除记忆" />
                                        </Popconfirm>
                                    </div>
                                </div>
                                <div className="whitespace-pre-wrap break-words text-sm leading-6 text-stone-700 dark:text-stone-200">{memory.content}</div>
                            </div>
                        ))}
                        {!memories.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有长期记忆" /> : null}
                    </div>
                </div>
            </Drawer>
        </div>
    );
}

function WelcomeEmpty({ preset }: { preset: ChatPresetOption }) {
    return (
        <div className="grid min-h-[52vh] place-items-center text-center">
            <div className="max-w-md">
                <div className="mx-auto grid size-14 place-items-center rounded-full border border-amber-300/50 bg-amber-100/55 text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/10 dark:text-amber-200">
                    <MessageCircle className="size-6" />
                </div>
                <h1 className="mt-5 text-2xl font-semibold tracking-[0.18em]">问道台</h1>
                <div className="mt-3 text-sm leading-6 text-stone-700 dark:text-stone-200">{preset.greeting}</div>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                    {preset.tags.map((tag) => (
                        <Tag key={tag}>{tag}</Tag>
                    ))}
                </div>
                <div className="mt-4 space-y-1 text-xs leading-6 text-stone-500 dark:text-stone-400">
                    {welcomeLines.map((line) => (
                        <div key={line}>{line}</div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function createOptimisticUserMessage(pending: PendingChatTurn, content: string, attachments: ChatAttachment[]): ChatMessage {
    return {
        id: pending.optimisticUserId,
        conversationId: pending.conversationId,
        role: "user",
        content,
        attachments,
        status: "completed",
        error: "",
        createdAt: pending.createdAt,
        updatedAt: pending.createdAt,
        isOptimistic: true,
    };
}

function createOptimisticAssistantMessage(pending: PendingChatTurn, error: string): ChatMessage {
    return {
        id: pending.optimisticAssistantId,
        conversationId: pending.conversationId,
        role: "assistant",
        content: "",
        attachments: [],
        status: "failed",
        error,
        createdAt: pending.createdAt + 1,
        updatedAt: pending.createdAt + 1,
        isOptimistic: true,
    };
}

export const ChatBubble = memo(function ChatBubble({ item, isLatest, onAction }: { item: ChatMessage; isLatest: boolean; onAction: (action: ChatMessageAction, item: ChatMessage) => void }) {
    const isUser = item.role === "user";
    const copyText = useCopyText();
    const markdownContent = item.content;
    const copyValue = item.status === "streaming" ? "" : item.content.trim() || (item.status === "failed" ? item.error?.trim() || "" : "");
    const canDelete = !item.isOptimistic && item.status !== "streaming";
    const menuItems = [
        ...(item.status === "completed" && item.content.trim() ? [{ key: "remember", label: "记住这句话", icon: <Brain className="size-3.5" /> }] : []),
        ...(isUser && item.status === "completed" ? [{ key: "edit", label: "编辑问题", icon: <Pencil className="size-3.5" /> }] : []),
        ...(!isUser && isLatest && item.status === "completed" ? [{ key: "continue", label: "继续生成", icon: <MoreHorizontal className="size-3.5" /> }, { key: "retry", label: "重新生成", icon: <RotateCcw className="size-3.5" /> }] : []),
        ...(!isUser && isLatest && item.status === "failed" ? [{ key: "retry", label: "重试回答", icon: <RotateCcw className="size-3.5" /> }] : []),
        ...(canDelete ? [{ key: "delete", label: "删除并回退", icon: <Trash2 className="size-3.5" /> }] : []),
    ];
    return (
        <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
            <div
                className={cn(
                    "min-w-0 max-w-full overflow-hidden rounded-xl px-4 py-4 text-base leading-7 tracking-normal shadow-sm sm:px-5",
                    isUser ? "sm:max-w-[90%] bg-stone-900 text-white dark:bg-[#f2dfb0] dark:text-stone-950" : "w-full border border-stone-200 bg-white text-stone-800 dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f5efe3]",
                )}
            >
                {item.attachments.length ? (
                    <div className="mb-2 flex flex-wrap gap-2">
                        {item.attachments.map((attachment) => (
                            <a key={attachment.assetKey} href={attachment.url} target="_blank" rel="noreferrer" className="block h-24 w-24 overflow-hidden rounded-lg border border-white/20 bg-black/5">
                                {attachment.url ? <img src={attachment.url} alt={attachment.name} loading="lazy" decoding="async" className="h-full w-full object-cover" /> : null}
                            </a>
                        ))}
                    </div>
                ) : null}
                {isUser ? (
                    <div className="whitespace-pre-wrap break-words">{item.content}</div>
                ) : item.status === "streaming" && !item.content ? (
                    <div className="whitespace-pre-wrap break-words">正在推演...</div>
                ) : markdownContent ? (
                    <Suspense fallback={<div className="whitespace-pre-wrap break-words">{markdownContent}</div>}>
                        <ChatMarkdown className="agent-streamdown chat-prose" content={markdownContent} />
                    </Suspense>
                ) : item.status !== "failed" ? (
                    <div className="whitespace-pre-wrap break-words">未返回内容</div>
                ) : null}
                {item.status === "failed" ? <div role="status" className="mt-2 text-sm text-stone-500 dark:text-stone-300">{userFacingErrorMessage(item.error, "这次回答暂未完成，可以再试一次。")}</div> : null}
                {item.status === "failed" && item.error ? <details className="mt-1 text-xs text-stone-500 dark:text-stone-400"><summary className="min-h-11 cursor-pointer py-3">查看详情</summary><p className="max-h-32 overflow-y-auto break-words whitespace-pre-wrap leading-5">{friendlyErrorMessage(item.error)}</p></details> : null}
                {copyValue || menuItems.length ? (
                    <div className={cn("mt-3 flex items-center gap-1", isUser ? "justify-end" : "justify-start")}>
                        {copyValue ? (
                            <Tooltip title="复制文字">
                                <Button
                                    type="text"
                                    size="small"
                                    className={cn(
                                        "!h-7 !w-7 !min-w-7 !p-0",
                                        isUser
                                            ? "!text-white/65 hover:!bg-white/10 hover:!text-white dark:!text-stone-700/65 dark:hover:!bg-stone-900/10 dark:hover:!text-stone-900"
                                            : "!text-stone-400 hover:!bg-stone-100 hover:!text-stone-700 dark:hover:!bg-white/10 dark:hover:!text-stone-200",
                                    )}
                                    aria-label="复制文字"
                                    icon={<Copy className="size-3.5" />}
                                    onClick={() => copyText(copyValue, isUser ? "问题已复制" : "回答已复制")}
                                />
                            </Tooltip>
                        ) : null}
                        {menuItems.length ? (
                            <Dropdown
                                trigger={["click"]}
                                placement={isUser ? "bottomRight" : "bottomLeft"}
                                menu={{
                                    items: menuItems,
                                    onClick: ({ key }) => {
                                        if (key === "edit" || key === "continue" || key === "retry" || key === "delete" || key === "remember") onAction(key, item);
                                    },
                                }}
                            >
                                <Button
                                    type="text"
                                    size="small"
                                    className={cn(
                                        "!h-7 !w-7 !min-w-7 !p-0",
                                        isUser
                                            ? "!text-white/65 hover:!bg-white/10 hover:!text-white dark:!text-stone-700/65 dark:hover:!bg-stone-900/10 dark:hover:!text-stone-900"
                                            : "!text-stone-400 hover:!bg-stone-100 hover:!text-stone-700 dark:hover:!bg-white/10 dark:hover:!text-stone-200",
                                    )}
                                    aria-label="消息操作"
                                    icon={<MoreHorizontal className="size-3.5" />}
                                />
                            </Dropdown>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
});

function readLocalChatPreset(userId: string): ChatPresetId {
    if (!userId) return defaultChatPresetId;
    try {
        const value = window.localStorage.getItem(`${CHAT_PRESET_STORAGE_KEY}${encodeURIComponent(userId)}`);
        return chatPresetOptions.some((preset) => preset.id === value) ? (value as ChatPresetId) : defaultChatPresetId;
    } catch {
        return defaultChatPresetId;
    }
}

function writeLocalChatPreset(userId: string, presetId: ChatPresetId) {
    if (!userId) return;
    try {
        window.localStorage.setItem(`${CHAT_PRESET_STORAGE_KEY}${encodeURIComponent(userId)}`, presetId);
    } catch {
        // A blocked localStorage must not prevent server preference persistence.
    }
}

function safeChatFilename(title: string) {
    const normalized = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").trim();
    return (normalized || "问道会话").slice(0, 60);
}

function upsertConversation(items: ChatConversation[], conversation: ChatConversation) {
    return [conversation, ...items.filter((item) => item.id !== conversation.id)].sort((left, right) => right.updatedAt - left.updatedAt);
}

function memoryKindLabel(kind: ChatMemory["kind"]) {
    return ({ summary: "摘要", fact: "事实", preference: "偏好", goal: "目标" })[kind];
}
