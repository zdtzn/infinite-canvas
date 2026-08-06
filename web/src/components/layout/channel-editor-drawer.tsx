import { App, Button, Drawer, Input, Segmented, Select, Space } from "antd";
import { Cable, ListPlus, SlidersHorizontal, Trash2 } from "lucide-react";
import { Suspense, useEffect, useState } from "react";

import { lazyRoute } from "@/lib/lazy-route";
import { defaultBaseUrlForApiFormat, guessCapability, normalizeChannelModels, type ApiCallFormat, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { ModelSelectModal } from "./model-select-modal";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { testServerChannel } from "@/services/server-api";
import { ImageCapabilityEditor } from "./image-capability-editor";

const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
    { label: "OpenAI", value: "openai" },
    { label: "Gemini", value: "gemini" },
];

const capabilityOptions: Array<{ label: string; value: ModelCapability }> = [
    { label: "生图", value: "image" },
    { label: "视频", value: "video" },
    { label: "文本", value: "text" },
    { label: "音频", value: "audio" },
];

type ScriptTarget = { name: string; capability: ModelCapability; value: string };
type ImageCapabilityTarget = { name: string };
const ModelScriptEditor = lazyRoute(() => import("./model-script-editor").then((module) => ({ default: module.ModelScriptEditor })));

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void | Promise<void>; onClose: () => void }) {
    const { message } = App.useApp();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [imageCapabilityTarget, setImageCapabilityTarget] = useState<ImageCapabilityTarget | null>(null);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);

    useEffect(() => {
        if (open && channel) setDraft(channel);
    }, [open, channel]);

    if (!draft) return null;

    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const setModels = (models: ChannelModel[]) => patch({ models });

    const changeApiFormat = (apiFormat: ApiCallFormat) => {
        const baseUrl = !draft.baseUrl.trim() || draft.baseUrl.trim() === defaultBaseUrlForApiFormat(draft.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : draft.baseUrl;
        patch({ apiFormat, baseUrl });
    };

    const applySelection = (names: string[]) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        setModels(
            names.map((name) => {
                const existing = map.get(name);
                if (existing) return existing;
                const capability = guessCapability(name);
                return { name, capability, ...(capability === "image" ? { imageCapabilities: { mode: "auto" as const } } : {}) };
            }),
        );
    };

    const setCapability = (name: string, capability: ModelCapability) =>
        setModels(draft.models.map((model) => (model.name !== name ? model : capability === "image" ? { ...model, capability, imageCapabilities: model.imageCapabilities || { mode: "auto" } } : { ...model, capability, imageCapabilities: undefined })));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const setImageCapabilities = (name: string, imageCapabilities: NonNullable<ChannelModel["imageCapabilities"]>) => setModels(draft.models.map((model) => (model.name === name ? { ...model, imageCapabilities } : model)));
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));

    const testConnection = async () => {
        setTesting(true);
        try {
            const result = await testServerChannel(draft);
            message.success(`连接成功，读取到 ${result.modelCount} 个模型`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "渠道连接失败");
        } finally {
            setTesting(false);
        }
    };

    const save = async () => {
        setSaving(true);
        try {
            await onSave({ ...draft, name: draft.name.trim() || "未命名渠道", models: normalizeChannelModels(draft.models) });
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "渠道保存失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Drawer
            open={open}
            width="min(640px, 100vw)"
            title="编辑渠道"
            onClose={onClose}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" loading={saving} onClick={() => void save()}>
                        保存
                    </Button>
                </Space>
            }
        >
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">渠道名称</span>
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">协议</span>
                    <Select className="w-full" value={draft.apiFormat} options={apiFormatOptions} onChange={changeApiFormat} />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">接口地址</span>
                    <Input value={draft.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://api.example.com" />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">API Key</span>
                    <Input.Password value={draft.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} placeholder={draft.credentialState === "saved" ? "已安全保存；留空表示不更换" : "sk-..."} />
                </label>
                {PUBLIC_MODE ? (
                    <div className="md:col-span-2 flex justify-end">
                        <Button icon={<Cable className="size-4" />} loading={testing} onClick={() => void testConnection()}>
                            测试连接
                        </Button>
                    </div>
                ) : null}
            </div>

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">渠道模型</div>
                    <div className="mt-0.5 text-xs text-stone-500">已选 {draft.models.length} 个；为每个模型指定生图、视频、文本或音频能力。</div>
                </div>
                <Button type="primary" icon={<ListPlus className="size-4" />} onClick={() => setSelectOpen(true)}>
                    选择模型
                </Button>
            </div>

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {draft.models.length ? (
                    draft.models.map((model) => (
                        <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                            <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>
                                {model.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                                <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                {model.capability === "image" ? (
                                    <Button size="small" icon={<SlidersHorizontal className="size-3.5" />} onClick={() => setImageCapabilityTarget({ name: model.name })}>
                                        生图能力
                                    </Button>
                                ) : null}
                                {!PUBLIC_MODE ? (
                                    <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                        {model.script ? "脚本已设" : "调用脚本"}
                                    </Button>
                                ) : null}
                                <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-stone-500">点击「选择模型」拉取或手动增加模型。</div>
                )}
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />

            {imageCapabilityTarget ? (
                <ImageCapabilityEditor
                    open
                    modelName={imageCapabilityTarget.name}
                    apiFormat={draft.apiFormat}
                    baseUrl={draft.baseUrl}
                    value={draft.models.find((model) => model.name === imageCapabilityTarget.name)?.imageCapabilities}
                    onSave={(imageCapabilities) => setImageCapabilities(imageCapabilityTarget.name, imageCapabilities)}
                    onClose={() => setImageCapabilityTarget(null)}
                />
            ) : null}

            {!PUBLIC_MODE && scriptTarget ? (
                <Suspense fallback={null}>
                    <ModelScriptEditor open capability={scriptTarget.capability} modelName={scriptTarget.name} value={scriptTarget.value} onSave={(script) => setScript(scriptTarget.name, script)} onClose={() => setScriptTarget(null)} />
                </Suspense>
            ) : null}
        </Drawer>
    );
}
