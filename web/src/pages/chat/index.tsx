import { App, Button, Drawer, Dropdown, Empty, Input, Popconfirm, Segmented, Skeleton, Tag, Tooltip } from "antd";
import { BookOpen, Brain, ChevronDown, Copy, Download, FileUp, ImagePlus, LoaderCircle, MessageCircle, MoreHorizontal, Pencil, Plus, RotateCcw, Send, Sparkles, Trash2, UserRound, X } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { lazyRoute } from "@/lib/lazy-route";
import { useCopyText } from "@/hooks/use-copy-text";
import { cancelChatMessage, createChatConversation, createChatMemory, deleteChatConversation, deleteChatMemory, fetchChatConversation, fetchChatConversations, fetchChatMemories, importChatConversation, sendChatMessage, truncateChatMessages, updateChatConversationPreset, updateChatMemory, uploadChatImage, type ChatAttachment, type ChatCanvasContext, type ChatConversation, type ChatMemory, type ChatMessage } from "@/services/chat-api";
import { fetchServerUserPreferences, saveServerUserPreferences } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { useCanvasContextStore } from "@/stores/use-canvas-context-store";
import { useChatRuntimeStore } from "@/stores/use-chat-runtime-store";
import { chatPresetOption, chatPresetOptions, defaultChatPresetId, type ChatPresetId, type ChatPresetOption } from "./chat-presets";

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
    terminal: boolean;
    completion: Promise<void>;
    userMessageId?: string;
    assistantMessageId?: string;
    retryAssistantMessageId?: string;
    editUserMessageId?: string;
    continueAssistantMessageId?: string;
};

type ChatMode = "chat" | "douqi";

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
    const [creating, setCreating] = useState(false);
    const [importing, setImporting] = useState(false);
    const [sending, setSending] = useState(false);
    const [mode, setMode] = useState<ChatMode>("chat");
    const [uploading, setUploading] = useState(false);
    const [draft, setDraft] = useState("");
    const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
    const [editingMessageId, setEditingMessageId] = useState("");
    const [presetId, setPresetId] = useState<ChatPresetId>(() => readLocalChatPreset(userId));
    const [presetReadyUser, setPresetReadyUser] = useState("");
    const [chatPersona, setChatPersona] = useState("");
    const [personaDraft, setPersonaDraft] = useState("");
    const [personaSaving, setPersonaSaving] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const [memoryOpen, setMemoryOpen] = useState(false);
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

    const activeConversation = conversations.find((item) => item.id === activeConversationId) || null;
    const activePresetId = activeConversation?.presetId || presetId;
    const activePreset = chatPresetOption(activePresetId as ChatPresetId);
    const activeHasStreamingMessage = messages.some((item) => item.status === "streaming");

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

        void fetchServerUserPreferences(userId)
            .then((preferences) => {
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
                message.error(error instanceof Error ? error.message : "问道角色加载失败");
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
        void fetchChatMemories(userId)
            .then((response) => {
                if (!canceled) setMemories(response.items);
            })
            .catch((error) => {
                if (!canceled) message.error(error instanceof Error ? error.message : "长期记忆加载失败");
            });
        return () => {
            canceled = true;
        };
    }, [message, userId]);

    useEffect(() => {
        if (!userId) return;
        let canceled = false;
        setLoading(true);
        void fetchChatConversations(userId)
            .then((response) => {
                if (canceled) return;
                setConversations(response.items);
                setActiveConversationId((current) => {
                    const next = response.items.some((item) => item.id === current) ? current : response.items[0]?.id || "";
                    activeConversationIdRef.current = next;
                    return next;
                });
            })
            .catch((error) => !canceled && message.error(error instanceof Error ? error.message : "问道记录加载失败"))
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
        setDetailLoading(true);
        void fetchChatConversation(activeConversationId, userId)
            .then((detail) => {
                if (canceled) return;
                setMessages((current) => {
                    const pending = pendingTurnRef.current;
                    if (pending?.conversationId !== activeConversationId) return detail.messages;
                    const transientIds = new Set([pending.optimisticUserId, pending.optimisticAssistantId, pending.userMessageId, pending.assistantMessageId].filter((id): id is string => Boolean(id)));
                    const transientMessages = current.filter((item) => transientIds.has(item.id) && !detail.messages.some((message) => message.id === item.id));
                    return [...detail.messages, ...transientMessages].sort((left, right) => left.createdAt - right.createdAt);
                });
                setConversations((current) => upsertConversation(current, detail.conversation));
            })
            .catch((error) => !canceled && message.error(error instanceof Error ? error.message : "对话加载失败"))
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
                    if (pending?.conversationId !== activeConversationId) return detail.messages;
                    const transientIds = new Set(
                        [pending.optimisticUserId, pending.optimisticAssistantId, pending.userMessageId, pending.assistantMessageId].filter(
                            (id): id is string => Boolean(id),
                        ),
                    );
                    const transientMessages = current.filter(
                        (item) => transientIds.has(item.id) && !detail.messages.some((message) => message.id === item.id),
                    );
                    return [...detail.messages, ...transientMessages].sort((left, right) => left.createdAt - right.createdAt);
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

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: sending ? "smooth" : "auto" });
    }, [messages, sending]);

    const canSend = Boolean((draft.trim() || attachments.length) && !sending && !uploading);

    function confirmPendingNavigation(action: string) {
        if (!pendingTurnRef.current || pendingTurnRef.current.terminal) return Promise.resolve(true);
        message.info(`当前回答会在后台继续，已允许${action}`);
        return Promise.resolve(true);
    }

    async function stopActiveTurn() {
        const pending = pendingTurnRef.current;
        if (!pending) return;
        if (!pending.terminal) {
            pending.stopped = true;
            useChatRuntimeStore.getState().setRuntime({ pending: true, status: "stopping", conversationId: pending.conversationId });
            const stoppedMessage = "本次回答已停止";
            if (activeConversationIdRef.current === pending.conversationId) {
                setMessages((current) => {
                    const assistantId = pending.retryAssistantMessageId || pending.continueAssistantMessageId || pending.assistantMessageId || pending.optimisticAssistantId;
                    if (current.some((item) => item.id === assistantId)) {
                        return current.map((item) => (item.id === assistantId ? { ...item, status: "failed", error: stoppedMessage } : item));
                    }
                    return [...current, createOptimisticAssistantMessage(pending, stoppedMessage)];
                });
            }
            if (pending.assistantMessageId) {
                try {
                    await cancelChatMessage(pending.conversationId, pending.assistantMessageId, userId);
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "停止回答失败");
                }
            }
            abortRef.current?.abort();
        }
        await pending.completion;
    }

    async function selectConversation(id: string) {
        if (id === activeConversationIdRef.current) return;
        if (!(await confirmPendingNavigation("切换"))) return;
        activeConversationIdRef.current = id;
        setActiveConversationId(id);
        setMessages([]);
        setEditingMessageId("");
        setDraft("");
        setAttachments([]);
    }

    async function handleNewConversation() {
        if (!userId || creating) return;
        if (!(await confirmPendingNavigation("新建"))) return;
        setCreating(true);
        try {
            const response = await createChatConversation({ presetId }, userId);
            setConversations((current) => [response.conversation, ...current]);
            activeConversationIdRef.current = response.conversation.id;
            setActiveConversationId(response.conversation.id);
            setMessages([]);
            setEditingMessageId("");
            setDraft("");
            setAttachments([]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "新建问道失败");
        } finally {
            setCreating(false);
        }
    }

    function handleExportConversation() {
        if (!activeConversation) {
            message.info("请先打开一段问道");
            return;
        }
        const payload = {
            format: "infinite-canvas.chat",
            version: 1,
            exportedAt: new Date().toISOString(),
            conversation: {
                title: activeConversation.title,
                presetId: activeConversation.presetId,
            },
            messages: messages
                .filter((item) => !item.id.startsWith("optimistic-") && item.status !== "streaming")
                .map((item) => ({
                    role: item.role,
                    content: item.content,
                    status: item.status,
                    error: item.error,
                    attachments: item.attachments.map(({ assetKey, mimeType, name }) => ({ assetKey, mimeType, name })),
                })),
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${safeChatFilename(activeConversation.title)}.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        message.success("会话已导出");
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
            setConversations((current) => [response.conversation, ...current.filter((item) => item.id !== response.conversation.id)]);
            activeConversationIdRef.current = response.conversation.id;
            setActiveConversationId(response.conversation.id);
            setMessages(response.messages);
            setEditingMessageId("");
            setDraft("");
            setAttachments([]);
            message.success(response.skippedAttachmentCount ? `会话已导入，${response.skippedAttachmentCount} 张图片未恢复` : "会话已导入");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "会话文件导入失败");
        } finally {
            setImporting(false);
        }
    }

    async function ensureConversation() {
        if (activeConversationIdRef.current) return activeConversationIdRef.current;
        const response = await createChatConversation({ presetId }, userId);
        setConversations((current) => [response.conversation, ...current]);
        activeConversationIdRef.current = response.conversation.id;
        setActiveConversationId(response.conversation.id);
        return response.conversation.id;
    }

    async function handleDeleteConversation(id: string) {
        const deletingActiveTurn = pendingTurnRef.current?.conversationId === id;
        if (deletingActiveTurn) await stopActiveTurn();
        try {
            await deleteChatConversation(id, userId);
            const next = conversations.filter((item) => item.id !== id);
            setConversations(next);
            if (activeConversationIdRef.current === id) {
                const nextId = next[0]?.id || "";
                activeConversationIdRef.current = nextId;
                setActiveConversationId(nextId);
                setMessages([]);
                setEditingMessageId("");
                setDraft("");
                setAttachments([]);
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除失败");
        }
    }

    async function handleUpload(files: FileList | null) {
        const selected = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        if (!selected.length) return;
        if (attachments.length + selected.length > 4) {
            message.warning("每次最多上传 4 张图片");
            return;
        }
        setUploading(true);
        try {
            const uploaded = await Promise.all(selected.map((file) => uploadChatImage(file, userId)));
            setAttachments((current) => [...current, ...uploaded]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "图片上传失败");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    }

    async function runChatTurn(input: {
        conversationId: string;
        content: string;
        attachments: ChatAttachment[];
        canvasContext?: ChatCanvasContext;
        retryAssistantMessageId?: string;
        editUserMessageId?: string;
        continueAssistantMessageId?: string;
        showOptimisticUser: boolean;
    }) {
        if (sendingRef.current || pendingTurnRef.current) return;
        sendingRef.current = true;
        const createdAt = Date.now();
        let resolveCompletion = () => {};
        const completion = new Promise<void>((resolve) => {
            resolveCompletion = resolve;
        });
        const pending: PendingChatTurn = {
            conversationId: input.conversationId,
            optimisticUserId: `optimistic-user-${createdAt}`,
            optimisticAssistantId: `optimistic-assistant-${createdAt}`,
            createdAt,
            started: false,
            stopped: false,
            terminal: false,
            completion,
            retryAssistantMessageId: input.retryAssistantMessageId,
            editUserMessageId: input.editUserMessageId,
            continueAssistantMessageId: input.continueAssistantMessageId,
        };
        pendingTurnRef.current = pending;
        const controller = new AbortController();
        abortRef.current = controller;
        setSending(true);
        useChatRuntimeStore.getState().setRuntime({ pending: true, status: "starting", conversationId: input.conversationId, startedAt: createdAt });
        if (input.showOptimisticUser) {
            setDraft("");
            setAttachments([]);
            setMessages((current) => [...current, createOptimisticUserMessage(pending, input.content, input.attachments)]);
        } else if (input.editUserMessageId && activeConversationIdRef.current === input.conversationId) {
            setDraft("");
            setAttachments([]);
            setMessages((current) => {
                const index = current.findIndex((item) => item.id === input.editUserMessageId);
                if (index < 0) return current;
                return [...current.slice(0, index), { ...current[index], content: input.content, attachments: input.attachments, updatedAt: createdAt }];
            });
        } else if (input.continueAssistantMessageId && activeConversationIdRef.current === input.conversationId) {
            setMessages((current) => current.map((item) => (item.id === input.continueAssistantMessageId ? { ...item, status: "streaming", error: "" } : item)));
        } else if (input.retryAssistantMessageId && activeConversationIdRef.current === input.conversationId) {
            setMessages((current) => current.map((item) => (item.id === input.retryAssistantMessageId ? { ...item, content: "", status: "streaming", error: "" } : item)));
        }
        try {
            await sendChatMessage({
                conversationId: input.conversationId,
                content: input.content,
                attachments: input.attachments,
                ...(input.retryAssistantMessageId ? { retryAssistantMessageId: input.retryAssistantMessageId } : {}),
                ...(input.editUserMessageId ? { editUserMessageId: input.editUserMessageId } : {}),
                ...(input.continueAssistantMessageId ? { continueAssistantMessageId: input.continueAssistantMessageId } : {}),
                ...(input.canvasContext ? { canvasContext: input.canvasContext } : {}),
                expectedUserId: userId,
                signal: controller.signal,
                onStarted: ({ conversation, userMessage, assistantMessage }) => {
                    pending.started = true;
                    useChatRuntimeStore.getState().setRuntime({ pending: true, status: "streaming", conversationId: input.conversationId, startedAt: createdAt });
                    pending.userMessageId = userMessage.id;
                    pending.assistantMessageId = assistantMessage.id;
                    setConversations((current) => upsertConversation(current, conversation));
                    if (activeConversationIdRef.current !== input.conversationId) return;
                    setMessages((current) => {
                        const replaceUserMessage = input.showOptimisticUser;
                        const hasUserMessage = current.some((item) => item.id === userMessage.id);
                        const replaceIds = new Set([
                            pending.optimisticUserId,
                            pending.optimisticAssistantId,
                            assistantMessage.id,
                            ...(replaceUserMessage ? [userMessage.id] : []),
                        ]);
                        return [
                            ...current.filter((item) => !replaceIds.has(item.id)),
                            ...(hasUserMessage ? [] : [userMessage]),
                            pending.stopped ? { ...assistantMessage, status: "failed", error: "本次回答已停止" } : assistantMessage,
                        ];
                    });
                },
                onDelta: ({ messageId, delta }) => {
                    if (pending.stopped || activeConversationIdRef.current !== input.conversationId) return;
                    setMessages((current) => current.map((item) => (item.id === messageId ? { ...item, content: item.content + delta } : item)));
                },
                onDone: ({ conversation, message: doneMessage }) => {
                    pending.terminal = true;
                    setConversations((current) => upsertConversation(current, conversation));
                    if (activeConversationIdRef.current !== input.conversationId) return;
                    setMessages((current) => (current.some((item) => item.id === doneMessage.id) ? current.map((item) => (item.id === doneMessage.id ? doneMessage : item)) : [...current, doneMessage]));
                },
                onError: ({ message: errorMessage, messageId }) => {
                    pending.terminal = true;
                    if (activeConversationIdRef.current === input.conversationId) {
                        const failedMessageId = messageId || pending.assistantMessageId || pending.optimisticAssistantId;
                        setMessages((current) => {
                            if (current.some((item) => item.id === failedMessageId)) {
                                return current.map((item) => (item.id === failedMessageId ? { ...item, status: "failed", error: pending.stopped ? "本次回答已停止" : errorMessage } : item));
                            }
                            return [...current, createOptimisticAssistantMessage(pending, pending.stopped ? "本次回答已停止" : errorMessage)];
                        });
                    }
                    if (!pending.stopped) message.error(errorMessage);
                },
            });
        } catch (error) {
            const aborted = error instanceof DOMException && error.name === "AbortError";
            if (aborted && !pending.stopped) return;
            const errorMessage = error instanceof Error ? error.message : "问道台暂未回应";
            if (activeConversationIdRef.current === input.conversationId) {
                setMessages((current) => {
                    const failedMessageId = pending.retryAssistantMessageId || pending.continueAssistantMessageId || pending.assistantMessageId;
                    if (failedMessageId) {
                        return current.map((item) => (item.id === failedMessageId ? { ...item, status: "failed", error: aborted ? "本次回答已停止" : errorMessage } : item));
                    }
                    return [...current, createOptimisticAssistantMessage(pending, aborted ? "本次回答已停止" : errorMessage)];
                });
            }
            if (!aborted) message.error(errorMessage);
        } finally {
            setSending(false);
            abortRef.current = null;
            if (pendingTurnRef.current === pending) pendingTurnRef.current = null;
            sendingRef.current = false;
            useChatRuntimeStore.getState().clearRuntime(input.conversationId);
            if (input.editUserMessageId) setEditingMessageId("");
            resolveCompletion();
        }
    }

    async function handleSend() {
        const content = draft.trim();
        if ((!content && !attachments.length) || sendingRef.current || sendStartingRef.current) return;
        sendStartingRef.current = true;
        try {
            const conversationId = await ensureConversation();
            await runChatTurn({ conversationId, content, attachments, canvasContext: canvasContext || undefined, editUserMessageId: editingMessageId || undefined, showOptimisticUser: !editingMessageId });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "问道台暂未回应");
        } finally {
            sendStartingRef.current = false;
        }
    }

    async function handleRetry(item: ChatMessage) {
        if (item.role !== "assistant" || !["failed", "completed"].includes(item.status) || item.id.startsWith("optimistic-")) return;
        if (pendingTurnRef.current) {
            message.info("请等待当前回答结束");
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
        if (item.role !== "assistant" || item.status !== "completed" || item.id.startsWith("optimistic-")) return;
        if (pendingTurnRef.current) {
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
        if (item.role !== "user" || item.status !== "completed" || item.id.startsWith("optimistic-") || sendingRef.current) return;
        setEditingMessageId(item.id);
        setDraft(item.content);
        setAttachments(item.attachments);
    }

    function cancelEdit() {
        setEditingMessageId("");
        setDraft("");
        setAttachments([]);
    }

    async function handleDeleteMessage(item: ChatMessage) {
        if (item.id.startsWith("optimistic-")) return;
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
            message.error(error instanceof Error ? error.message : "消息删除失败");
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
                message.error(error instanceof Error ? error.message : "问道角色切换失败");
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
                        message.error(error instanceof Error ? error.message : "问道角色保存失败");
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
            message.error(error instanceof Error ? error.message : "用户身份保存失败");
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
            message.error(error instanceof Error ? error.message : "记忆保存失败");
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
            message.error(error instanceof Error ? error.message : "保存长期记忆失败");
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
            message.error(error instanceof Error ? error.message : "记忆删除失败");
        }
    }

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
        <div className="h-full overflow-hidden bg-[#f7f5ef] text-stone-900 dark:bg-[#11100e] dark:text-[#f5efe3]">
            <input ref={importInputRef} type="file" accept=".json,application/json" className="hidden" onChange={(event) => void handleImportFile(event.target.files)} />
            <div className="mx-auto grid h-full max-w-[1480px] grid-cols-[280px_minmax(0,1fr)] gap-0 px-4 py-4 max-lg:grid-cols-1 max-lg:px-3">
                <aside className="min-h-0 border-r border-stone-200/80 pr-4 max-lg:hidden dark:border-white/10">
                    <div className="mb-4 flex items-center justify-between gap-2">
                        <div>
                            <div className="text-lg font-semibold tracking-[0.18em]">问道台</div>
                            <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">站内 AI 对话</div>
                        </div>
                        <Tooltip title="新建问道">
                            <Button shape="circle" type="text" icon={<Plus className="size-4" />} loading={creating} onClick={handleNewConversation} />
                        </Tooltip>
                    </div>
                    <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
                        {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
                        {!loading && !conversations.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无问道记录" /> : null}
                        {conversations.map((conversation) => (
                            <button
                                key={conversation.id}
                                type="button"
                                className={cn(
                                    "group flex w-full min-w-0 items-start gap-2 rounded-lg border px-3 py-2 text-left transition",
                                    conversation.id === activeConversationId
                                        ? "border-amber-400/70 bg-amber-50/80 text-stone-950 dark:border-amber-300/35 dark:bg-amber-300/10 dark:text-[#fff8e8]"
                                        : "border-transparent bg-white/45 hover:border-stone-200 hover:bg-white/80 dark:bg-white/[0.03] dark:hover:border-white/10 dark:hover:bg-white/[0.06]",
                                )}
                                onClick={() => void selectConversation(conversation.id)}
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
                                    <span className="rounded p-1 text-stone-400 opacity-0 transition hover:bg-stone-100 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-white/10" onClick={(event) => event.stopPropagation()}>
                                        <Trash2 className="size-3.5" />
                                    </span>
                                </Popconfirm>
                            </button>
                        ))}
                    </div>
                </aside>

                <main className="flex min-h-0 min-w-0 flex-col pl-4 max-lg:pl-0">
                    <div className="mb-3 flex shrink-0 items-center justify-between gap-3 rounded-xl border border-stone-200/80 bg-white/70 px-4 py-3 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="text-base font-semibold tracking-[0.12em]">问道台</span>
                                <Tag color="gold" bordered={false}>
                                    {activePreset.label}
                                </Tag>
                            </div>
                            <div className="mt-1 truncate text-xs text-stone-500 dark:text-stone-400">{activeConversation?.title || activePreset.description}</div>
                        </div>
                        <div className="flex min-w-0 items-center gap-2">
                            <Segmented
                                size="small"
                                value={mode}
                                options={[{ label: "普通问道", value: "chat" }, { label: "斗气人生", value: "douqi" }]}
                                onChange={(value) => setMode(value as ChatMode)}
                            />
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
                                    disabled={sending || importing}
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
                            <Button className="lg:hidden" icon={<Plus className="size-4" />} onClick={handleNewConversation} loading={creating}>
                                新建
                            </Button>
                        </div>
                    </div>

                    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-stone-200/80 bg-white/55 p-4 dark:border-white/10 dark:bg-black/10">
                        {detailLoading ? <Skeleton active paragraph={{ rows: 8 }} /> : null}
                        {!detailLoading && !messages.length ? <WelcomeEmpty preset={activePreset} /> : null}
                        <div className="space-y-5">
                            {messages.map((item, index) => (
                                <ChatBubble key={item.id} item={item} isLatest={index === messages.length - 1} onRetry={handleRetry} onContinue={handleContinue} onEdit={handleEdit} onDelete={handleDeleteMessage} onRemember={handleRememberMessage} />
                            ))}
                            {sending ? (
                                <div className="flex items-center gap-2 text-xs text-stone-500">
                                    <LoaderCircle className="size-3.5 animate-spin" />
                                    天地法则正在回应...
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
                                            className="absolute right-1 top-1 rounded-full bg-black/55 p-0.5 text-white opacity-0 transition group-hover:opacity-100"
                                            onClick={() => setAttachments((current) => current.filter((item) => item.assetKey !== attachment.assetKey))}
                                            aria-label="移除图片"
                                        >
                                            <X className="size-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                        <div className="flex items-end gap-2">
                            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => void handleUpload(event.target.files)} />
                            <Tooltip title="上传图片提问">
                                <Button
                                    type="text"
                                    className="!h-10 !w-10 !min-w-10"
                                    icon={uploading ? <LoaderCircle className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={sending || uploading}
                                />
                            </Tooltip>
                            <Dropdown
                                trigger={["click"]}
                                placement="topLeft"
                                disabled={sending}
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
                                <Button type="text" className="!h-10 shrink-0 !px-2.5 text-stone-600 dark:text-stone-200" icon={<Sparkles className="size-4 text-amber-600" />} disabled={sending} title={activePreset.hint}>
                                    <span className="inline-flex max-w-[92px] items-center gap-1 truncate text-xs">
                                        <span className="truncate">{activePreset.label}</span>
                                        <ChevronDown className="size-3 shrink-0" />
                                    </span>
                                </Button>
                            </Dropdown>
                            <Input.TextArea
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                autoSize={{ minRows: 1, maxRows: 6 }}
                                maxLength={20_000}
                                placeholder={`以「${activePreset.label}」向问道台提问...`}
                                onPressEnter={(event) => {
                                    if (event.shiftKey) return;
                                    event.preventDefault();
                                    void handleSend();
                                }}
                                disabled={sending}
                            />
                            {sending ? (
                                <Button className="!h-10" onClick={handleStop}>
                                    停止
                                </Button>
                            ) : (
                                <Button type="primary" className="!h-10" icon={<Send className="size-4" />} disabled={!canSend} onClick={() => void handleSend()}>
                                    {editingMessageId ? "保存并重答" : "发送"}
                                </Button>
                            )}
                        </div>
                    </div>
                </main>
            </div>
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
                        <div className="grid size-12 shrink-0 place-items-center rounded-xl border border-amber-300/50 bg-amber-100/60 text-lg font-semibold text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/10 dark:text-amber-200">
                            {activePreset.label.slice(0, 1)}
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
    };
}

function ChatBubble({ item, isLatest, onRetry, onContinue, onEdit, onDelete, onRemember }: { item: ChatMessage; isLatest: boolean; onRetry: (item: ChatMessage) => void; onContinue: (item: ChatMessage) => void; onEdit: (item: ChatMessage) => void; onDelete: (item: ChatMessage) => void; onRemember: (item: ChatMessage) => void }) {
    const isUser = item.role === "user";
    const copyText = useCopyText();
    const markdownContent = item.content;
    const copyValue = item.status === "streaming" ? "" : item.content.trim() || (item.status === "failed" ? item.error?.trim() || "" : "");
    const canDelete = !item.id.startsWith("optimistic-") && item.status !== "streaming";
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
                    "min-w-0 max-w-[82%] rounded-xl px-4 py-3 text-sm leading-6 shadow-sm",
                    isUser ? "bg-stone-900 text-white dark:bg-[#f2dfb0] dark:text-stone-950" : "border border-stone-200 bg-white text-stone-800 dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f5efe3]",
                )}
            >
                {item.attachments.length ? (
                    <div className="mb-2 flex flex-wrap gap-2">
                        {item.attachments.map((attachment) => (
                            <a key={attachment.assetKey} href={attachment.url} target="_blank" rel="noreferrer" className="block h-24 w-24 overflow-hidden rounded-lg border border-white/20 bg-black/5">
                                {attachment.url ? <img src={attachment.url} alt={attachment.name} className="h-full w-full object-cover" /> : null}
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
                        <ChatMarkdown className="agent-streamdown" content={markdownContent} />
                    </Suspense>
                ) : (
                    <div className="whitespace-pre-wrap break-words">{item.status === "failed" ? item.error || "未返回内容" : "未返回内容"}</div>
                )}
                {item.status === "failed" ? <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200">{item.error || "本次问道未能完成"}</div> : null}
                {copyValue || menuItems.length ? (
                    <div className={cn("mt-1.5 flex items-center gap-1", isUser ? "justify-end" : "justify-start")}>
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
                                        if (key === "edit") onEdit(item);
                                        if (key === "continue") onContinue(item);
                                        if (key === "retry") onRetry(item);
                                        if (key === "delete") onDelete(item);
                                        if (key === "remember") onRemember(item);
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
}

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
