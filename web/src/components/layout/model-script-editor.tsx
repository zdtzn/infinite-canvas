import { javascript } from "@codemirror/lang-javascript";
import CodeMirror from "@uiw/react-codemirror";
import { Button, Modal } from "antd";
import { useEffect, useState } from "react";

import { getPluginAuthoringPrompt, PLUGIN_RETURNS, PLUGIN_TEMPLATES, PLUGIN_VARIABLES } from "@/services/api/model-plugin";
import { useCopyText } from "@/hooks/use-copy-text";
import type { ModelCapability } from "@/stores/use-config-store";

const capabilityLabels: Record<ModelCapability, string> = { image: "生图", video: "视频", text: "文本", audio: "音频" };

function isDarkMode() {
    return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export function ModelScriptEditor({ open, capability, modelName, value, onSave, onClose }: { open: boolean; capability: ModelCapability; modelName: string; value: string; onSave: (script: string) => void; onClose: () => void }) {
    const copyText = useCopyText();
    const [draft, setDraft] = useState(value);
    useEffect(() => {
        if (open) setDraft(value);
    }, [open, value]);

    const variables = PLUGIN_VARIABLES.filter((variable) => !variable.capabilities || variable.capabilities.includes(capability));

    return (
        <Modal
            open={open}
            title={
                <div>
                    <div className="text-base font-semibold">
                        {capabilityLabels[capability]}
                        {modelName ? ` - ${modelName}` : ""}
                    </div>
                    <div className="mt-1 text-xs font-normal text-stone-500">脚本是一段异步函数体，直接使用下方变量，最后 return 结果；留空则使用系统默认调用。</div>
                </div>
            }
            width="100vw"
            style={{ top: 0, margin: 0, maxWidth: "100vw", paddingBottom: 0 }}
            wrapClassName="[&_.ant-modal-container]:!rounded-none [&_.ant-modal-container]:!h-dvh [&_.ant-modal-container]:!flex [&_.ant-modal-container]:!flex-col [&_.ant-modal-body]:!min-h-0 [&_.ant-modal-body]:!flex-1 [&_.ant-modal-body]:!overflow-hidden"
            onCancel={onClose}
            styles={{ body: { padding: 0 } }}
            footer={
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                        {PLUGIN_TEMPLATES[capability].map((template) => (
                            <Button key={template.label} size="small" onClick={() => setDraft(template.script)}>
                                插入{template.label}模板
                            </Button>
                        ))}
                        <Button size="small" danger onClick={() => setDraft("")}>
                            恢复默认调用
                        </Button>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button onClick={onClose}>取消</Button>
                        <Button
                            type="primary"
                            onClick={() => {
                                onSave(draft.trim());
                                onClose();
                            }}
                        >
                            保存
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="flex h-full min-h-0 flex-col border-t border-stone-200 md:flex-row dark:border-stone-800">
                <aside className="flex max-h-[35vh] w-full shrink-0 flex-col overflow-y-auto border-r border-stone-200 bg-stone-50/80 md:max-h-none md:w-[360px] dark:border-stone-800 dark:bg-stone-900/40">
                    <div className="border-b border-stone-200/70 px-4 py-3 dark:border-stone-800/70">
                        <div className="mb-1.5 text-sm font-semibold">1. 了解调用规则</div>
                        <p className="mb-2 text-xs leading-5 text-stone-500">脚本仅用于自定义本地渠道。现有脚本无需改写；留空恢复内置接口。</p>
                        <div className="text-xs leading-6 text-stone-600 dark:text-stone-300">{PLUGIN_RETURNS[capability]}</div>
                    </div>
                    <div className="border-b border-stone-200/70 px-4 py-3 dark:border-stone-800/70">
                        <div className="mb-2 text-sm font-semibold">2. 让 AI 帮你编写</div>
                        <p className="mb-3 text-xs leading-5 text-stone-500">复制说明，连同供应商接口文档交给 AI，再将返回的脚本粘贴到编辑区。说明包含变量和模板，不包含渠道密钥或当前草稿。</p>
                        <Button onClick={() => copyText(getPluginAuthoringPrompt(capability, modelName), "脚本编写说明已复制")}>复制编写说明</Button>
                    </div>
                    <div className="px-4 py-3">
                        <div className="mb-2.5 flex items-center justify-between">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">可用变量</span>
                            <span className="text-[10px] text-stone-400">点击插入</span>
                        </div>
                        <div className="space-y-1.5">
                            {variables.map((variable) => (
                                <button
                                    key={variable.name}
                                    type="button"
                                    onClick={() => setDraft((current) => (current ? `${current}\n${variable.name}` : variable.name))}
                                    className="group block w-full rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-stone-200 hover:bg-white dark:hover:border-stone-700 dark:hover:bg-stone-800/60"
                                >
                                    <div className="flex flex-wrap items-baseline gap-1.5">
                                        <code className="rounded bg-stone-200/80 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-stone-800 group-hover:bg-blue-100 group-hover:text-blue-700 dark:bg-stone-800 dark:text-stone-100 dark:group-hover:bg-blue-950 dark:group-hover:text-blue-300">
                                            {variable.name}
                                        </code>
                                        <span className="font-mono text-[10px] text-stone-400">{variable.type}</span>
                                    </div>
                                    <div className="mt-1 text-xs leading-5 text-stone-500 dark:text-stone-400">{variable.desc}</div>
                                </button>
                            ))}
                        </div>
                    </div>
                </aside>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-stone-950">
                    <div className="shrink-0 border-b border-stone-200 px-4 py-3 text-sm font-semibold dark:border-stone-800">3. 编辑并保存脚本</div>
                    <div className="min-h-0 flex-1 overflow-hidden">
                        <CodeMirror
                            value={draft}
                            onChange={setDraft}
                            height="100%"
                            theme={isDarkMode() ? "dark" : "light"}
                            extensions={[javascript()]}
                            placeholder={"// 留空使用系统默认调用；点击底部「插入模板」查看示例。"}
                            style={{ height: "100%", fontSize: 13 }}
                            className="h-full [&_.cm-editor]:h-full [&_.cm-gutters]:border-none [&_.cm-scroller]:overflow-auto"
                        />
                    </div>
                </div>
            </div>
        </Modal>
    );
}
