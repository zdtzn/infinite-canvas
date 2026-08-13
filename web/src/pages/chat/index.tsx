import { App, Button, Dropdown, Empty, Input, Popconfirm, Skeleton, Tag, Tooltip } from "antd";
import { ChevronDown, Copy, ImagePlus, LoaderCircle, MessageCircle, Plus, RotateCcw, Send, Sparkles, Trash2, X } from "lucide-react";
import { Streamdown } from "streamdown";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { useCopyText } from "@/hooks/use-copy-text";
import { createChatConversation, deleteChatConversation, fetchChatConversation, fetchChatConversations, sendChatMessage, updateChatConversationPreset, uploadChatImage, type ChatAttachment, type ChatConversation, type ChatMessage } from "@/services/chat-api";
import { fetchServerUserPreferences, saveServerUserPreferences } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { chatPresetOption, chatPresetOptions, defaultChatPresetId, type ChatPresetId } from "./chat-presets";

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
};

export default function ChatPage() {
    const { message, modal } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const userId = useUserStore((state) => state.user?.id || "");

    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [sending, setSending] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [draft, setDraft] = useState("");
    const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
    const [presetId, setPresetId] = useState<ChatPresetId>(() => readLocalChatPreset(userId));
    const [presetReadyUser, setPresetReadyUser] = useState("");
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
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: sending ? "smooth" : "auto" });
    }, [messages, sending]);

    useEffect(() => {
        const abortOnLeave = () => {
            const pending = pendingTurnRef.current;
            if (!pending || pending.terminal) return;
            pending.stopped = true;
            abortRef.current?.abort();
        };
        window.addEventListener("pagehide", abortOnLeave);
        return () => {
            window.removeEventListener("pagehide", abortOnLeave);
            abortOnLeave();
        };
    }, []);

    const canSend = Boolean((draft.trim() || attachments.length) && !sending && !uploading);

    function confirmPendingNavigation(action: string) {
        if (!pendingTurnRef.current || pendingTurnRef.current.terminal) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
            modal.confirm({
                title: "回答正在进行",
                content: `${action}会停止当前回答，已经收到的内容会保留。是否继续？`,
                okText: `停止并${action}`,
                cancelText: "继续等待",
                onOk: () => stopActiveTurn().then(() => resolve(true)).catch(() => resolve(false)),
                onCancel: () => resolve(false),
            });
        });
    }

    async function stopActiveTurn() {
        const pending = pendingTurnRef.current;
        if (!pending) return;
        if (!pending.terminal) {
            pending.stopped = true;
            const stoppedMessage = "本次回答已停止";
            if (activeConversationIdRef.current === pending.conversationId) {
                setMessages((current) => {
                    const assistantId = pending.retryAssistantMessageId || pending.assistantMessageId || pending.optimisticAssistantId;
                    if (current.some((item) => item.id === assistantId)) {
                        return current.map((item) => (item.id === assistantId ? { ...item, status: "failed", error: stoppedMessage } : item));
                    }
                    return [...current, createOptimisticAssistantMessage(pending, stoppedMessage)];
                });
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
        } catch (error) {
            message.error(error instanceof Error ? error.message : "新建问道失败");
        } finally {
            setCreating(false);
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
        retryAssistantMessageId?: string;
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
        };
        pendingTurnRef.current = pending;
        const controller = new AbortController();
        abortRef.current = controller;
        setSending(true);
        if (input.showOptimisticUser) {
            setDraft("");
            setAttachments([]);
            setMessages((current) => [...current, createOptimisticUserMessage(pending, input.content, input.attachments)]);
        } else if (input.retryAssistantMessageId && activeConversationIdRef.current === input.conversationId) {
            setMessages((current) => current.map((item) => (item.id === input.retryAssistantMessageId ? { ...item, content: "", status: "streaming", error: "" } : item)));
        }
        try {
            await sendChatMessage({
                conversationId: input.conversationId,
                content: input.content,
                attachments: input.attachments,
                ...(input.retryAssistantMessageId ? { retryAssistantMessageId: input.retryAssistantMessageId } : {}),
                expectedUserId: userId,
                signal: controller.signal,
                onStarted: ({ conversation, userMessage, assistantMessage }) => {
                    pending.started = true;
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
                    const failedMessageId = pending.retryAssistantMessageId || pending.assistantMessageId;
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
            resolveCompletion();
        }
    }

    async function handleSend() {
        const content = draft.trim();
        if ((!content && !attachments.length) || sendingRef.current || sendStartingRef.current) return;
        sendStartingRef.current = true;
        try {
            const conversationId = await ensureConversation();
            await runChatTurn({ conversationId, content, attachments, showOptimisticUser: true });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "问道台暂未回应");
        } finally {
            sendStartingRef.current = false;
        }
    }

    async function handleRetry(item: ChatMessage) {
        if (item.role !== "assistant" || item.status !== "failed" || item.id.startsWith("optimistic-")) return;
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

    return (
        <div className="h-full overflow-hidden bg-[#f7f5ef] text-stone-900 dark:bg-[#11100e] dark:text-[#f5efe3]">
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
                            <Button className="lg:hidden" icon={<Plus className="size-4" />} onClick={handleNewConversation} loading={creating}>
                                新建
                            </Button>
                        </div>
                    </div>

                    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-stone-200/80 bg-white/55 p-4 dark:border-white/10 dark:bg-black/10">
                        {detailLoading ? <Skeleton active paragraph={{ rows: 8 }} /> : null}
                        {!detailLoading && !messages.length ? <WelcomeEmpty /> : null}
                        <div className="space-y-5">
                            {messages.map((item) => (
                                <ChatBubble key={item.id} item={item} onRetry={handleRetry} />
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
                                    发送
                                </Button>
                            )}
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}

function WelcomeEmpty() {
    return (
        <div className="grid min-h-[52vh] place-items-center text-center">
            <div className="max-w-md">
                <div className="mx-auto grid size-14 place-items-center rounded-full border border-amber-300/50 bg-amber-100/55 text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/10 dark:text-amber-200">
                    <MessageCircle className="size-6" />
                </div>
                <h1 className="mt-5 text-2xl font-semibold tracking-[0.18em]">问道台</h1>
                <div className="mt-3 space-y-1 text-sm leading-6 text-stone-500 dark:text-stone-400">
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

function ChatBubble({ item, onRetry }: { item: ChatMessage; onRetry: (item: ChatMessage) => void }) {
    const isUser = item.role === "user";
    const copyText = useCopyText();
    const copyValue = item.status === "streaming" ? "" : item.content.trim() || (item.status === "failed" ? item.error?.trim() || "" : "");
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
                {isUser ? <div className="whitespace-pre-wrap break-words">{item.content}</div> : <Streamdown className="agent-streamdown">{item.content || (item.status === "streaming" ? "正在推演..." : item.error || "未返回内容")}</Streamdown>}
                {item.status === "failed" ? <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200">{item.error || "本次问道未能完成"}</div> : null}
                {item.role === "assistant" && item.status === "failed" && !item.id.startsWith("optimistic-") ? (
                    <Button
                        type="text"
                        size="small"
                        className="mt-2 !h-7 !px-1.5 !text-stone-500 hover:!bg-stone-100 hover:!text-stone-800 dark:!text-stone-400 dark:hover:!bg-white/10 dark:hover:!text-stone-100"
                        icon={<RotateCcw className="size-3.5" />}
                        onClick={() => onRetry(item)}
                    >
                        重试
                    </Button>
                ) : null}
                {copyValue ? (
                    <div className={cn("mt-1.5 flex", isUser ? "justify-end" : "justify-start")}>
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

function upsertConversation(items: ChatConversation[], conversation: ChatConversation) {
    return [conversation, ...items.filter((item) => item.id !== conversation.id)].sort((left, right) => right.updatedAt - left.updatedAt);
}
