import { App, Button, Dropdown, Empty, Input, Popconfirm, Skeleton, Tag, Tooltip } from "antd";
import { ChevronDown, ImagePlus, LoaderCircle, MessageCircle, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { Streamdown } from "streamdown";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { createChatConversation, deleteChatConversation, fetchChatConversation, fetchChatConversations, sendChatMessage, uploadChatImage, type ChatAttachment, type ChatConversation, type ChatMessage } from "@/services/chat-api";
import { useUserStore } from "@/stores/use-user-store";
import { chatPresetOption, chatPresetOptions, defaultChatPresetId, type ChatPresetId } from "./chat-presets";

const welcomeLines = [
    "把疑问交给此方天地。",
    "可上传图片，让模型结合画面回答。",
    "这里适合聊创意、提示词、商品图、画面结构和日常问题。",
];

export default function ChatPage() {
    const { message } = App.useApp();
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
    const [presetId, setPresetId] = useState<ChatPresetId>(defaultChatPresetId);

    const activeConversation = conversations.find((item) => item.id === activeConversationId) || null;
    const activePreset = chatPresetOption(presetId);

    useEffect(() => {
        if (!userId) return;
        let canceled = false;
        setLoading(true);
        void fetchChatConversations(userId)
            .then((response) => {
                if (canceled) return;
                setConversations(response.items);
                setActiveConversationId((current) => (response.items.some((item) => item.id === current) ? current : response.items[0]?.id || ""));
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
                setMessages(detail.messages);
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

    const canSend = Boolean((draft.trim() || attachments.length) && activeConversationId && !sending && !uploading);

    async function handleNewConversation() {
        if (!userId || creating) return;
        setCreating(true);
        try {
            const response = await createChatConversation({}, userId);
            setConversations((current) => [response.conversation, ...current]);
            setActiveConversationId(response.conversation.id);
            setMessages([]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "新建问道失败");
        } finally {
            setCreating(false);
        }
    }

    async function ensureConversation() {
        if (activeConversationId) return activeConversationId;
        const response = await createChatConversation({}, userId);
        setConversations((current) => [response.conversation, ...current]);
        setActiveConversationId(response.conversation.id);
        return response.conversation.id;
    }

    async function handleDeleteConversation(id: string) {
        try {
            await deleteChatConversation(id, userId);
            setConversations((current) => {
                const next = current.filter((item) => item.id !== id);
                if (activeConversationId === id) setActiveConversationId(next[0]?.id || "");
                return next;
            });
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

    async function handleSend() {
        const content = draft.trim();
        if (!content && !attachments.length) return;
        const conversationId = await ensureConversation();
        const controller = new AbortController();
        abortRef.current = controller;
        setSending(true);
        setDraft("");
        setAttachments([]);
        try {
            await sendChatMessage({
                conversationId,
                content,
                presetId,
                attachments,
                expectedUserId: userId,
                signal: controller.signal,
                onStarted: ({ conversation, userMessage, assistantMessage }) => {
                    setConversations((current) => upsertConversation(current, conversation));
                    setMessages((current) => [...current, userMessage, assistantMessage]);
                },
                onDelta: ({ messageId, delta }) => {
                    setMessages((current) => current.map((item) => (item.id === messageId ? { ...item, content: item.content + delta } : item)));
                },
                onDone: ({ conversation, message: doneMessage }) => {
                    setConversations((current) => upsertConversation(current, conversation));
                    setMessages((current) => current.map((item) => (item.id === doneMessage.id ? doneMessage : item)));
                },
                onError: ({ message: errorMessage, messageId }) => {
                    setMessages((current) => current.map((item) => (item.id === messageId ? { ...item, status: "failed", error: errorMessage } : item)));
                    message.error(errorMessage);
                },
            });
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return;
            const errorMessage = error instanceof Error ? error.message : "问道台暂未回应";
            message.error(errorMessage);
        } finally {
            setSending(false);
            abortRef.current = null;
        }
    }

    function handleStop() {
        abortRef.current?.abort();
        setSending(false);
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
                                onClick={() => setActiveConversationId(conversation.id)}
                            >
                                <MessageCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium">{conversation.title}</span>
                                    <span className="mt-0.5 block truncate text-xs text-stone-500 dark:text-stone-400">{conversation.lastMessage || "新的问道"}</span>
                                </span>
                                <Popconfirm title="删除这段问道？" okText="删除" cancelText="取消" onConfirm={(event) => { event?.stopPropagation(); void handleDeleteConversation(conversation.id); }}>
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
                                <Tag color="gold" bordered={false}>{activePreset.label}</Tag>
                            </div>
                            <div className="mt-1 truncate text-xs text-stone-500 dark:text-stone-400">{activeConversation?.title || activePreset.description}</div>
                        </div>
                        <div className="flex min-w-0 items-center gap-2">
                            <Button className="lg:hidden" icon={<Plus className="size-4" />} onClick={handleNewConversation} loading={creating}>新建</Button>
                        </div>
                    </div>

                    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-stone-200/80 bg-white/55 p-4 dark:border-white/10 dark:bg-black/10">
                        {detailLoading ? <Skeleton active paragraph={{ rows: 8 }} /> : null}
                        {!detailLoading && !messages.length ? <WelcomeEmpty /> : null}
                        <div className="space-y-5">
                            {messages.map((item) => <ChatBubble key={item.id} item={item} />)}
                            {sending ? <div className="flex items-center gap-2 text-xs text-stone-500"><LoaderCircle className="size-3.5 animate-spin" />天地法则正在回应...</div> : null}
                        </div>
                    </div>

                    <div className="mt-3 shrink-0 rounded-xl border border-stone-200/80 bg-white/85 p-3 shadow-sm dark:border-white/10 dark:bg-[#171512]">
                        {attachments.length ? (
                            <div className="mb-3 flex flex-wrap gap-2">
                                {attachments.map((attachment) => (
                                    <div key={attachment.assetKey} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-stone-200 bg-stone-50 dark:border-white/10 dark:bg-white/5">
                                        {attachment.url ? <img src={attachment.url} alt={attachment.name} className="h-full w-full object-cover" /> : null}
                                        <button type="button" className="absolute right-1 top-1 rounded-full bg-black/55 p-0.5 text-white opacity-0 transition group-hover:opacity-100" onClick={() => setAttachments((current) => current.filter((item) => item.assetKey !== attachment.assetKey))} aria-label="移除图片">
                                            <X className="size-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                        <div className="flex items-end gap-2">
                            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => void handleUpload(event.target.files)} />
                            <Tooltip title="上传图片提问">
                                <Button type="text" className="!h-10 !w-10 !min-w-10" icon={uploading ? <LoaderCircle className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} onClick={() => fileInputRef.current?.click()} disabled={sending || uploading} />
                            </Tooltip>
                            <Dropdown
                                trigger={["click"]}
                                placement="topLeft"
                                disabled={sending}
                                menu={{
                                    selectedKeys: [presetId],
                                    onClick: ({ key }) => setPresetId(key as ChatPresetId),
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
                                <Button
                                    type="text"
                                    className="!h-10 shrink-0 !px-2.5 text-stone-600 dark:text-stone-200"
                                    icon={<Sparkles className="size-4 text-amber-600" />}
                                    disabled={sending}
                                    title={activePreset.hint}
                                >
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
                                <Button className="!h-10" onClick={handleStop}>停止</Button>
                            ) : (
                                <Button type="primary" className="!h-10" icon={<Send className="size-4" />} disabled={!canSend} onClick={() => void handleSend()}>发送</Button>
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
                    {welcomeLines.map((line) => <div key={line}>{line}</div>)}
                </div>
            </div>
        </div>
    );
}

function ChatBubble({ item }: { item: ChatMessage }) {
    const isUser = item.role === "user";
    return (
        <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
            <div className={cn("min-w-0 max-w-[82%] rounded-xl px-4 py-3 text-sm leading-6 shadow-sm", isUser ? "bg-stone-900 text-white dark:bg-[#f2dfb0] dark:text-stone-950" : "border border-stone-200 bg-white text-stone-800 dark:border-white/10 dark:bg-white/[0.04] dark:text-[#f5efe3]")}> 
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
            </div>
        </div>
    );
}

function upsertConversation(items: ChatConversation[], conversation: ChatConversation) {
    return [conversation, ...items.filter((item) => item.id !== conversation.id)].sort((left, right) => right.updatedAt - left.updatedAt);
}
