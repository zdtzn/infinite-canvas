import { Archive, Box, Check, ChevronRight, FlaskConical, FolderPlus, ImagePlus, Layers3, LoaderCircle, PackageSearch, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";
import { App, Button, Checkbox, Empty, Input, Popconfirm, Progress, Select, Skeleton, Tag, Tooltip } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { ModelPicker } from "@/components/model-picker";
import { PUBLIC_MODE } from "@/constant/runtime-config";
import { generationFailureFeedback, generationFailureText } from "@/features/cultivation/generation-messages";
import { cultivationProfileQueryKey, useCultivationProfile } from "@/features/cultivation/queries";
import { cultivationGenerationBlockReason, requiredCultivationCapabilities } from "@/features/cultivation/utils";
import {
    availableProductOutputs,
    buildMultiStyleProductPlan,
    buildProductVisualStyleGuide,
    emptyProductAnalysis,
    productDetailPageLimit,
    productOutputDefinitions,
    productRealmExperience,
    productSectionTypeLabel,
    productStyleOptions,
    reconcileProductPlanSelection,
    resolveProductTemplatePrompt,
    selectedProductOutputKinds,
    toggleProductPlanItemSelection,
    toggleProductPlanKindSelection,
    type ProductAnalysis,
    type ProductOutputKind,
    type ProductPlanItem,
    type ProductSectionType,
} from "@/features/product-lab/product-lab";
import { ProductOutputGrid, ProductRealmHeader } from "@/features/product-lab/product-lab-view";
import { readImageMeta } from "@/lib/image-utils";
import { cn } from "@/lib/utils";
import { requestEdit } from "@/services/api/image";
import { getImageBlob, uploadImage } from "@/services/image-storage";
import {
    analyzeProduct,
    createProductProject,
    deleteProductProject,
    fetchProductGenerations,
    fetchProductLabContext,
    fetchProductProjects,
    saveProductGeneration,
    updateProductProject,
    type ProductGeneration,
    type ProductProject,
    type ProductTemplate,
} from "@/services/product-lab-api";
import { PRODUCT_LAB_ASSET_SOURCE } from "@/stores/asset-source";
import { resolveImageModelSettings } from "@/stores/image-model-settings";
import { useAssetStore } from "@/stores/use-asset-store";
import { selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import type { ReferenceImage } from "@/types/image";

type ProductAnalysisDraft = ProductAnalysis & { sourceNotes?: string };
type GenerationProgress = { completed: number; total: number; title: string; failed: number };

const PLATFORM_OPTIONS = [{ value: "pinduoduo", label: "拼多多" }];
const MAX_BATCH_UPLOADS = 8;

export default function ProductLabPage() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const userId = useUserStore((state) => state.user?.id || "");
    const { data: profile, isLoading: profileLoading } = useCultivationProfile();
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);

    const [projects, setProjects] = useState<ProductProject[]>([]);
    const [activeProjectId, setActiveProjectId] = useState("");
    const [generations, setGenerations] = useState<ProductGeneration[]>([]);
    const [templates, setTemplates] = useState<ProductTemplate[]>([]);
    const [analysisAvailable, setAnalysisAvailable] = useState(false);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [batchAnalyzing, setBatchAnalyzing] = useState(false);
    const [savingPlan, setSavingPlan] = useState(false);
    const [savingArchiveIds, setSavingArchiveIds] = useState<string[]>([]);
    const [generating, setGenerating] = useState(false);
    const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
    const [imperialEntryVisible, setImperialEntryVisible] = useState(false);
    const [draftAnalysis, setDraftAnalysis] = useState<ProductAnalysisDraft>(emptyProductAnalysis());
    const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
    const [selectedStyles, setSelectedStyles] = useState<string[]>(["clean"]);
    const [pendingTemplateSelection, setPendingTemplateSelection] = useState<{ kind: ProductOutputKind; styleKey: string } | null>(null);
    const [brandName, setBrandName] = useState("");
    const savingArchiveIdsRef = useRef(new Set<string>());

    const activeProject = projects.find((project) => project.id === activeProjectId) || null;
    const realmExperience = productRealmExperience(profile?.realmName || "斗之气");
    const detailPageLimit = productDetailPageLimit(profile?.realmName || "斗之气");
    const productCapabilities = profile?.capabilities || [];
    const canAnalyze = productCapabilities.includes("product.analysis");
    const canUseMultipleStyles = productCapabilities.includes("product.multi_style");
    const canBatch = productCapabilities.includes("product.batch_generate");
    const canUseBrand = productCapabilities.includes("product.brand_design");
    const model = effectiveConfig.imageModel || effectiveConfig.model;
    const imageModels = selectableModelsByCapability(effectiveConfig, "image");
    const resolvedImageSettings = resolveImageModelSettings(effectiveConfig, model, 1);
    const selectedModelSupportsProductReference = imageModels.includes(model) && resolvedImageSettings.capabilities.maxReferences > 0;
    const outputs = useMemo(
        () =>
            availableProductOutputs({
                capabilities: productCapabilities,
                imageModelAvailable: selectedModelSupportsProductReference,
                analysisAvailable: analysisAvailable || Boolean(activeProject && hasProductAnalysis(activeProject)),
            }),
        [activeProject, analysisAvailable, productCapabilities, selectedModelSupportsProductReference],
    );
    const outputSignature = outputs.map((output) => `${output.kind}:${output.available}`).join("|");
    const visualPlan = useMemo(
        () =>
            buildMultiStyleProductPlan({
                analysis: draftAnalysis,
                platform: activeProject?.platform || "pinduoduo",
                styleKeys: selectedStyles,
                brandName: canUseBrand ? brandName : "",
                detailPageLimit,
            }),
        [activeProject?.platform, brandName, canUseBrand, detailPageLimit, draftAnalysis, selectedStyles],
    );
    const selectablePlanItems = useMemo(
        () => visualPlan.filter((item) => outputs.some((output) => output.kind === item.kind && output.available)),
        [outputs, visualPlan],
    );
    const selectablePlanSignature = selectablePlanItems.map((item) => item.id).join("|");
    const selectedPlanItems = selectablePlanItems.filter((item) => selectedPlanIds.includes(item.id));
    const selectedKinds = selectedProductOutputKinds(selectedPlanIds, selectablePlanItems);
    const activeVisualStyleGuide = buildProductVisualStyleGuide(draftAnalysis, selectedStyles[0] || "clean", canUseBrand ? brandName : "");
    const archivedAssetKeys = useMemo(
        () => new Set(assets.flatMap((asset) => (asset.kind === "image" && asset.data.storageKey ? [asset.data.storageKey] : []))),
        [assets],
    );
    const genericGenerationRequirements = requiredCultivationCapabilities({
        model,
        quality: resolvedImageSettings.config.quality,
        referenceCount: activeProject ? 1 : 0,
        hasMask: false,
    });
    const generationBlockReason = profile
        ? cultivationGenerationBlockReason({
              remainingToday: profile.remainingToday,
              unlimited: profile.unlimited,
              maxConcurrency: profile.maxConcurrency,
              capabilities: profile.capabilities,
              requestedCount: selectedPlanItems.length,
              requiredCapabilities: genericGenerationRequirements,
          })
        : null;

    useEffect(() => {
        if (!userId && PUBLIC_MODE) return;
        let canceled = false;
        setLoading(true);
        void Promise.all([fetchProductLabContext(userId), fetchProductProjects(userId)])
            .then(([context, projectResponse]) => {
                if (canceled) return;
                setAnalysisAvailable(context.analysisAvailable);
                setTemplates(context.templates);
                setProjects(projectResponse.items);
                setActiveProjectId((current) => (projectResponse.items.some((project) => project.id === current) ? current : projectResponse.items[0]?.id || ""));
            })
            .catch((error) => !canceled && message.error(error instanceof Error ? error.message : "商品项目加载失败"))
            .finally(() => !canceled && setLoading(false));
        return () => {
            canceled = true;
        };
    }, [message, userId]);

    useEffect(() => {
        if (!activeProject || !userId) {
            setGenerations([]);
            return;
        }
        let canceled = false;
        void fetchProductGenerations(activeProject.id, userId)
            .then((response) => !canceled && setGenerations(response.items))
            .catch((error) => !canceled && message.error(error instanceof Error ? error.message : "商品生成记录加载失败"));
        return () => {
            canceled = true;
        };
    }, [activeProject?.id, message, userId]);

    useEffect(() => {
        setSelectedPlanIds([]);
        setPendingTemplateSelection(null);
        if (!activeProject) {
            setDraftAnalysis(emptyProductAnalysis());
            setSelectedStyles(["clean"]);
            setBrandName("");
            return;
        }
        setDraftAnalysis(normalizeProjectAnalysis(activeProject));
        setSelectedStyles(inferProjectStyles(activeProject));
        setBrandName(activeProject.brandName || "");
    }, [activeProject?.id, activeProject?.updatedAt]);

    useEffect(() => {
        setSelectedPlanIds((current) => reconcileProductPlanSelection(current, selectablePlanItems));
    }, [activeProject?.id, outputSignature, selectablePlanSignature]);

    useEffect(() => {
        if (!pendingTemplateSelection) return;
        const matching = selectablePlanItems.filter((item) => item.kind === pendingTemplateSelection.kind && item.styleKey === pendingTemplateSelection.styleKey);
        if (!matching.length) return;
        setSelectedPlanIds(matching.map((item) => item.id));
        setPendingTemplateSelection(null);
    }, [pendingTemplateSelection, selectablePlanSignature]);

    useEffect(() => {
        if (!realmExperience.imperial) {
            setImperialEntryVisible(false);
            return;
        }
        setImperialEntryVisible(true);
        const timer = window.setTimeout(() => setImperialEntryVisible(false), 2_200);
        return () => window.clearTimeout(timer);
    }, [realmExperience.imperial]);

    const replaceProject = (project: ProductProject) => {
        setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)].sort((left, right) => right.updatedAt - left.updatedAt));
    };

    const uploadProducts = async (files: File[]) => {
        if (!files.length || uploading) return;
        const images = files.filter((file) => file.type.startsWith("image/"));
        if (!images.length) {
            message.warning("请选择商品图片");
            return;
        }
        const limit = canBatch ? MAX_BATCH_UPLOADS : 1;
        const accepted = images.slice(0, limit);
        if (images.length > limit) message.warning(canBatch ? `单次最多导入 ${limit} 个商品` : "当前境界每次只能导入一个商品");
        setUploading(true);
        const created: ProductProject[] = [];
        try {
            for (const file of accepted) {
                const uploaded = await uploadImage(file, { expectedUserId: userId });
                const title = productTitleFromFile(file.name);
                const response = await createProductProject(
                    {
                        title,
                        platform: "pinduoduo",
                        styleKey: selectedStyles[0] || "clean",
                        sourceAssetKey: uploaded.storageKey,
                    },
                    userId,
                );
                created.push(response.project);
            }
            setProjects((current) => [...created, ...current]);
            if (created[0]) setActiveProjectId(created[0].id);
            message.success(created.length > 1 ? `已导入 ${created.length} 个商品项目` : "商品已进入炼制台");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "商品导入失败");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const analyzeOneProject = async (project: ProductProject, notes: string) => {
        const response = await analyzeProduct(
            {
                assetKey: project.sourceAssetKey,
                platform: project.platform,
                styleKey: project.styleKey,
                notes,
            },
            userId,
        );
        const analysis: ProductAnalysisDraft = { ...response.analysis, sourceNotes: notes };
        const styles = inferProjectStyles(project);
        const plan = buildMultiStyleProductPlan({
            analysis,
            platform: project.platform,
            styleKeys: styles,
            brandName: project.brandName,
            detailPageLimit: productDetailPageLimit(profile?.realmName || "斗之气"),
        });
        const updated = await updateProductProject(project.id, { title: analysis.productName || project.title, status: "planned", analysis, plan }, userId).then((result) => result.project);
        replaceProject(updated);
        return updated;
    };

    const analyzeCurrentProject = async () => {
        if (!activeProject || analyzing) return;
        if (!canAnalyze) {
            message.warning("当前境界尚不足以开启此项商品法则。继续修炼即可掌握。");
            return;
        }
        if (!analysisAvailable) {
            message.warning("管理员尚未配置可识别商品图片的文本模型");
            return;
        }
        setAnalyzing(true);
        try {
            const updated = await analyzeOneProject(activeProject, draftAnalysis.sourceNotes || "");
            setDraftAnalysis(normalizeProjectAnalysis(updated));
            message.success("商品本源解析完成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "商品分析暂未完成");
        } finally {
            setAnalyzing(false);
        }
    };

    const analyzePendingProjects = async () => {
        if (!canBatch || batchAnalyzing) return;
        if (!canAnalyze || !analysisAvailable) {
            message.warning("当前尚无法批量解析商品");
            return;
        }
        const pending = projects.filter((project) => !hasProductAnalysis(project));
        if (!pending.length) {
            message.info("当前商品项目均已完成解析");
            return;
        }
        setBatchAnalyzing(true);
        let completed = 0;
        try {
            for (const project of pending) {
                await analyzeOneProject(project, "");
                completed += 1;
            }
            message.success(`已完成 ${completed} 个商品项目的解析`);
        } catch (error) {
            message.error(`${completed ? `已完成 ${completed} 个，` : ""}${error instanceof Error ? error.message : "批量解析中断"}`);
        } finally {
            setBatchAnalyzing(false);
        }
    };

    const savePlanning = async () => {
        if (!activeProject || savingPlan) return;
        const analysis = normalizeDraftAnalysis(draftAnalysis, activeProject.title);
        const plan = buildMultiStyleProductPlan({
            analysis,
            platform: activeProject.platform,
            styleKeys: selectedStyles,
            brandName: canUseBrand ? brandName : "",
            detailPageLimit,
        });
        setSavingPlan(true);
        try {
            const updated = await updateProductProject(
                activeProject.id,
                {
                    title: analysis.productName,
                    styleKey: selectedStyles[0] || "clean",
                    brandName: canUseBrand ? brandName : "",
                    status: "planned",
                    analysis,
                    plan,
                },
                userId,
            ).then((result) => result.project);
            replaceProject(updated);
            setDraftAnalysis(normalizeProjectAnalysis(updated));
            message.success("商品视觉规划已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "规划保存失败");
        } finally {
            setSavingPlan(false);
        }
    };

    const generateSelectedPlan = async () => {
        if (!activeProject || generating) return;
        if (!selectedPlanItems.length) {
            message.warning("请先选择需要炼制的商品画卷");
            return;
        }
        if (!selectedModelSupportsProductReference) {
            message.warning("请选择支持参考图的生图模型");
            return;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning("请先完成生图渠道配置");
            openConfigDialog(true, "channels");
            return;
        }
        if (generationBlockReason) {
            message.warning(generationBlockReason);
            return;
        }

        const reference: ReferenceImage = {
            id: activeProject.sourceAssetKey,
            name: activeProject.title,
            type: "image/*",
            dataUrl: activeProject.sourceUrl,
            storageKey: activeProject.sourceAssetKey,
        };
        setGenerating(true);
        setGenerationProgress({ completed: 0, total: selectedPlanItems.length, title: "正在解析商品灵韵...", failed: 0 });
        const completedGenerations: ProductGeneration[] = [];
        let failed = 0;
        try {
            for (const [index, item] of selectedPlanItems.entries()) {
                setGenerationProgress({ completed: index, total: selectedPlanItems.length, title: item.title, failed });
                let serverJobId = "";
                try {
                    const configured = resolveImageModelSettings(
                        {
                            ...effectiveConfig,
                            model,
                            imageModel: model,
                            size: item.aspectRatio,
                            count: "1",
                        },
                        model,
                        1,
                    ).config;
                    const images = await requestEdit({ ...configured, model: configured.imageModel, count: "1" }, item.prompt, [reference], undefined, {
                        expectedUserId: userId,
                        source: { route: "/product-lab", projectId: activeProject.id, label: `商品幻境 · ${item.title}` },
                        onJobCreated: (jobId) => {
                            serverJobId = jobId;
                        },
                    });
                    const image = images[0];
                    if (!image) throw new Error("接口没有返回商品图片");
                    const stored = await uploadImage(image.dataUrl, { outputFormat: configured.imageOutputFormat, expectedUserId: userId });
                    const saved = await saveProductGeneration(
                        {
                            projectId: activeProject.id,
                            outputKind: item.kind,
                            pageIndex: item.pageIndex,
                            prompt: item.prompt,
                            jobId: serverJobId || undefined,
                            assetKey: stored.storageKey,
                            status: "succeeded",
                        },
                        userId,
                    );
                    completedGenerations.push(saved.generation);
                } catch (error) {
                    failed += 1;
                    const failure = generationFailureFeedback(error, { isDouEmperor: realmExperience.imperial });
                    await saveProductGeneration(
                        {
                            projectId: activeProject.id,
                            outputKind: item.kind,
                            pageIndex: item.pageIndex,
                            prompt: item.prompt,
                            jobId: serverJobId || undefined,
                            status: "failed",
                            error: generationFailureText(failure),
                        },
                        userId,
                    ).catch(() => undefined);
                }
                setGenerationProgress({ completed: index + 1, total: selectedPlanItems.length, title: item.title, failed });
            }

            const nextStatus = completedGenerations.length ? "completed" : "planned";
            const updated = await updateProductProject(
                activeProject.id,
                {
                    status: nextStatus,
                    styleKey: selectedStyles[0] || "clean",
                    brandName: canUseBrand ? brandName : "",
                    analysis: normalizeDraftAnalysis(draftAnalysis, activeProject.title),
                    plan: visualPlan,
                },
                userId,
            ).then((result) => result.project);
            replaceProject(updated);
            setGenerations((current) => [...current, ...completedGenerations]);
            if (completedGenerations.length) {
                message.success(realmExperience.imperial ? "一念落笔，万象成卷。可择卷入藏。" : "商品画卷炼制完成，可手动选择入藏。");
            }
            if (failed) message.warning(`${failed} 幅画卷未能凝聚，失败额度已按现有规则处理`);
        } finally {
            setGenerating(false);
            void queryClient.invalidateQueries({ queryKey: cultivationProfileQueryKey });
        }
    };

    const archiveGeneration = async (generation: ProductGeneration) => {
        if (!activeProject || !generation.assetKey || !generation.assetUrl) {
            message.error("当前画卷文件不可用，暂时无法入藏");
            return;
        }
        if (archivedAssetKeys.has(generation.assetKey)) {
            message.info("此卷已在藏卷阁中");
            return;
        }
        if (savingArchiveIdsRef.current.has(generation.id)) return;

        const project = activeProject;
        savingArchiveIdsRef.current.add(generation.id);
        setSavingArchiveIds((current) => [...current, generation.id]);
        try {
            const blob = await getImageBlob(generation.assetKey, userId);
            if (!blob) throw new Error("画卷文件不存在");
            const objectUrl = URL.createObjectURL(blob);
            let imageMeta: Awaited<ReturnType<typeof readImageMeta>>;
            try {
                imageMeta = await readImageMeta(objectUrl);
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
            addAsset({
                kind: "image",
                title: productGenerationTitle(project.title, generation),
                coverUrl: generation.assetUrl,
                tags: ["商品视觉", outputLabel(generation.outputKind)],
                source: PRODUCT_LAB_ASSET_SOURCE,
                data: {
                    dataUrl: generation.assetUrl,
                    storageKey: generation.assetKey,
                    width: imageMeta.width,
                    height: imageMeta.height,
                    bytes: blob.size,
                    mimeType: blob.type || imageMeta.mimeType,
                },
                metadata: {
                    source: "product-lab",
                    projectId: project.id,
                    generationId: generation.id,
                    outputKind: generation.outputKind,
                    pageIndex: generation.pageIndex,
                    prompt: generation.prompt,
                },
            });
            message.success("已入藏卷阁");
        } catch (error) {
            message.error(error instanceof Error ? `入藏卷阁失败：${error.message}` : "入藏卷阁失败，请重试");
        } finally {
            savingArchiveIdsRef.current.delete(generation.id);
            setSavingArchiveIds((current) => current.filter((id) => id !== generation.id));
        }
    };

    const removeProject = async (project: ProductProject) => {
        try {
            await deleteProductProject(project.id, userId);
            setProjects((current) => current.filter((item) => item.id !== project.id));
            if (activeProjectId === project.id) {
                const next = projects.find((item) => item.id !== project.id);
                setActiveProjectId(next?.id || "");
            }
            message.success("商品项目已移除，藏卷阁作品不受影响");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "商品项目删除失败");
        }
    };

    const toggleOutput = (kind: ProductOutputKind) => {
        setSelectedPlanIds((current) => toggleProductPlanKindSelection(current, selectablePlanItems, kind));
    };

    const togglePlanItem = (itemId: string) => {
        setSelectedPlanIds((current) => toggleProductPlanItemSelection(current, itemId));
    };

    const toggleStyle = (styleKey: string) => {
        if (!canUseMultipleStyles) {
            setSelectedStyles([styleKey]);
            return;
        }
        setSelectedStyles((current) => {
            if (current.includes(styleKey)) return current.length === 1 ? current : current.filter((item) => item !== styleKey);
            if (current.length >= 3) {
                message.warning("单个商品最多同时规划 3 种视觉方向");
                return current;
            }
            return [...current, styleKey];
        });
    };

    const applyTemplate = (template: ProductTemplate) => {
        const output = outputs.find((item) => item.kind === template.outputKind);
        if (!output?.available) {
            message.warning(output?.reason || "当前尚无法使用此模板");
            return;
        }
        setSelectedStyles([template.styleKey]);
        setDraftAnalysis((current) => {
            const baseDirection = current.visualDirection.split("；模板要求：", 1)[0].trim();
            const templatePrompt = resolveProductTemplatePrompt(template.promptTemplate, current.productName);
            return { ...current, visualDirection: [baseDirection, `模板要求：${templatePrompt}`].filter(Boolean).join("；") };
        });
        setPendingTemplateSelection({ kind: template.outputKind, styleKey: template.styleKey });
    };

    return (
        <div className={cn("product-lab-page h-full overflow-y-auto bg-[#f7f7f5] text-stone-900 dark:bg-[#101110] dark:text-stone-100", realmExperience.imperial && "is-imperial")}>
            <ProductRealmHeader
                realmName={profile?.realmName || "斗之气"}
                stageName={profile?.stageName || "一段"}
                title={realmExperience.title}
                description={realmExperience.description}
                imperial={realmExperience.imperial}
                capabilities={productCapabilities}
            />
            {imperialEntryVisible ? (
                <div className="product-imperial-entry pointer-events-none fixed inset-x-0 top-16 z-30 mx-auto w-fit border border-[#c9a86a]/35 bg-[#111714]/94 px-5 py-3 text-center shadow-2xl backdrop-blur-xl">
                    <div className="text-sm font-medium text-[#e4d2aa]">正在开启帝境商品领域...</div>
                    <div className="mt-1 text-xs text-[#b8ab91]">天地法则正在解析商品本源</div>
                </div>
            ) : null}

            <div className="mx-auto grid min-h-[calc(100%-132px)] max-w-[1560px] grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)_400px]">
                <aside className="border-b border-stone-200 bg-white/55 p-4 dark:border-white/10 dark:bg-white/[0.018] lg:border-r lg:border-b-0">
                    <SectionHeading
                        icon={<PackageSearch className="size-4" />}
                        title="商品项目"
                        action={
                            canBatch && projects.length ? (
                                <Tooltip title="批量解析尚未分析的商品">
                                    <Button type="text" size="small" loading={batchAnalyzing} icon={<RefreshCw className="size-3.5" />} onClick={analyzePendingProjects} aria-label="批量解析商品" />
                                </Tooltip>
                            ) : null
                        }
                    />
                    <input ref={fileInputRef} type="file" accept="image/*" multiple={canBatch} className="hidden" onChange={(event) => void uploadProducts(Array.from(event.target.files || []))} />
                    <button
                        type="button"
                        className="mt-4 flex min-h-36 w-full flex-col items-center justify-center border border-dashed border-stone-300 bg-white/50 px-4 text-center transition hover:border-stone-500 hover:bg-white dark:border-white/15 dark:bg-white/[0.025] dark:hover:border-white/30"
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                            event.preventDefault();
                            void uploadProducts(Array.from(event.dataTransfer.files || []));
                        }}
                    >
                        {uploading ? <LoaderCircle className="size-6 animate-spin text-stone-500" /> : <Upload className="size-6 text-stone-500" />}
                        <span className="mt-3 text-sm font-medium">上传商品图片</span>
                        <span className="mt-1 text-xs leading-5 text-stone-500">{canBatch ? `支持一次导入 ${MAX_BATCH_UPLOADS} 个商品` : "拖入图片或点击选择"}</span>
                    </button>

                    <div className="mt-5 space-y-2">
                        {loading ? (
                            <Skeleton active paragraph={{ rows: 4 }} title={false} />
                        ) : projects.length ? (
                            projects.map((project) => (
                                <button
                                    key={project.id}
                                    type="button"
                                    className={cn(
                                        "group flex w-full items-center gap-3 border p-2.5 text-left transition",
                                        project.id === activeProjectId
                                            ? "border-stone-950 bg-stone-950 text-white dark:border-[#c9a86a]/65 dark:bg-[#c9a86a]/10 dark:text-[#f2ead8]"
                                            : "border-stone-200 bg-transparent hover:border-stone-400 dark:border-white/10 dark:hover:border-white/25",
                                    )}
                                    onClick={() => setActiveProjectId(project.id)}
                                >
                                    <img src={project.sourceUrl} alt="" className="size-12 shrink-0 bg-stone-100 object-cover dark:bg-white/5" loading="lazy" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium">{project.title}</span>
                                        <span className="mt-1 block text-xs opacity-60">{projectStatusLabel(project.status)}</span>
                                    </span>
                                    <ChevronRight className="size-4 shrink-0 opacity-35" />
                                </button>
                            ))
                        ) : (
                            <div className="py-8 text-center text-xs leading-5 text-stone-500">上传第一张商品图后，项目会保存在当前账号中。</div>
                        )}
                    </div>
                </aside>

                <main className="min-w-0 p-5 lg:p-7">
                    {profileLoading || loading ? (
                        <Skeleton active paragraph={{ rows: 10 }} />
                    ) : activeProject ? (
                        <div className="space-y-8">
                            <section>
                                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                                    <div>
                                        <div className="text-xs font-medium text-stone-500">商品本源</div>
                                        <h2 className="mt-1 text-xl font-semibold">识别商品，整理真实卖点</h2>
                                        <p className="mt-2 text-sm text-stone-500">分析由后台文本模型完成，不消耗生图额度。识别结果可继续编辑。</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button loading={analyzing} icon={<Sparkles className="size-4" />} onClick={analyzeCurrentProject} disabled={!canAnalyze || !analysisAvailable}>
                                            解析商品
                                        </Button>
                                        <Popconfirm title="移除这个商品项目？" description="已入藏卷阁的作品不会删除。" okText="移除" cancelText="取消" onConfirm={() => removeProject(activeProject)}>
                                            <Tooltip title="移除项目">
                                                <Button danger type="text" icon={<Trash2 className="size-4" />} aria-label="移除商品项目" />
                                            </Tooltip>
                                        </Popconfirm>
                                    </div>
                                </div>

                                <div className="mt-6 grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)]">
                                    <div className="aspect-square overflow-hidden border border-stone-200 bg-white dark:border-white/10 dark:bg-white/[0.025]">
                                        <img src={activeProject.sourceUrl} alt={activeProject.title} className="size-full object-contain" />
                                    </div>
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <Field label="商品名称">
                                            <Input value={draftAnalysis.productName} maxLength={120} onChange={(event) => setDraftAnalysis((current) => ({ ...current, productName: event.target.value }))} />
                                        </Field>
                                        <Field label="商品类目">
                                            <Input value={draftAnalysis.category} maxLength={120} placeholder="例如：茶具 / 家居 / 食品" onChange={(event) => setDraftAnalysis((current) => ({ ...current, category: event.target.value }))} />
                                        </Field>
                                        <Field label="细分类">
                                            <Input value={draftAnalysis.subcategory} maxLength={120} placeholder="例如：马克杯 / 便携榨汁杯" onChange={(event) => setDraftAnalysis((current) => ({ ...current, subcategory: event.target.value }))} />
                                        </Field>
                                        <Field label="目标人群">
                                            <Input value={draftAnalysis.targetAudience} maxLength={500} placeholder="这件商品适合谁" onChange={(event) => setDraftAnalysis((current) => ({ ...current, targetAudience: event.target.value }))} />
                                        </Field>
                                        <Field label="标题建议">
                                            <Input value={draftAnalysis.titleSuggestion} maxLength={200} placeholder="保持真实，不堆砌夸张词" onChange={(event) => setDraftAnalysis((current) => ({ ...current, titleSuggestion: event.target.value }))} />
                                        </Field>
                                        <Field label="商品卖点" className="sm:col-span-2">
                                            <Input.TextArea
                                                value={draftAnalysis.sellingPoints.join("\n")}
                                                autoSize={{ minRows: 3, maxRows: 6 }}
                                                placeholder="每行一个可确认的卖点"
                                                onChange={(event) =>
                                                    setDraftAnalysis((current) => ({
                                                        ...current,
                                                        sellingPoints: event.target.value
                                                            .split(/\r?\n/)
                                                            .map((item) => item.trim())
                                                            .filter(Boolean)
                                                            .slice(0, 8),
                                                    }))
                                                }
                                            />
                                        </Field>
                                        <details className="sm:col-span-2 border-y border-stone-200 py-3 dark:border-white/10">
                                            <summary className="cursor-pointer text-sm font-medium text-stone-700 marker:text-stone-400 dark:text-stone-300">商品事实与详情页依据</summary>
                                            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                                <Field label="材质">
                                                    <Input value={draftAnalysis.material} maxLength={240} placeholder="只填写可确认材质" onChange={(event) => setDraftAnalysis((current) => ({ ...current, material: event.target.value }))} />
                                                </Field>
                                                <Field label="固有颜色">
                                                    <Input value={draftAnalysis.color} maxLength={240} placeholder="商品本身的颜色，不是背景色" onChange={(event) => setDraftAnalysis((current) => ({ ...current, color: event.target.value }))} />
                                                </Field>
                                                <Field label="真实使用场景">
                                                    <Input.TextArea
                                                        value={draftAnalysis.usageScenarios.join("\n")}
                                                        autoSize={{ minRows: 3, maxRows: 6 }}
                                                        placeholder="每行一个真实使用场景"
                                                        onChange={(event) => setDraftAnalysis((current) => ({ ...current, usageScenarios: lines(event.target.value, 8) }))}
                                                    />
                                                </Field>
                                                <Field label="可确认差异点">
                                                    <Input.TextArea
                                                        value={draftAnalysis.differentiationPoints.join("\n")}
                                                        autoSize={{ minRows: 3, maxRows: 6 }}
                                                        placeholder="每行一个真实差异点"
                                                        onChange={(event) => setDraftAnalysis((current) => ({ ...current, differentiationPoints: lines(event.target.value, 8) }))}
                                                    />
                                                </Field>
                                                <Field label="用户顾虑">
                                                    <Input.TextArea
                                                        value={draftAnalysis.userConcerns.join("\n")}
                                                        autoSize={{ minRows: 3, maxRows: 6 }}
                                                        placeholder="例如：是否易清洁、尺寸是否合适"
                                                        onChange={(event) => setDraftAnalysis((current) => ({ ...current, userConcerns: lines(event.target.value, 8) }))}
                                                    />
                                                </Field>
                                                <Field label="结构与使用事实">
                                                    <Input.TextArea
                                                        value={draftAnalysis.additionalInformation}
                                                        autoSize={{ minRows: 3, maxRows: 6 }}
                                                        maxLength={2_000}
                                                        placeholder="部件关系、使用方式、已确认规格和未知信息"
                                                        onChange={(event) => setDraftAnalysis((current) => ({ ...current, additionalInformation: event.target.value }))}
                                                    />
                                                </Field>
                                            </div>
                                        </details>
                                        <Field label="视觉方向">
                                            <Input.TextArea
                                                value={draftAnalysis.visualDirection}
                                                autoSize={{ minRows: 2, maxRows: 5 }}
                                                maxLength={1_000}
                                                placeholder="例如：明亮、克制、留白充足"
                                                onChange={(event) => setDraftAnalysis((current) => ({ ...current, visualDirection: event.target.value }))}
                                            />
                                        </Field>
                                        <Field label="补充说明">
                                            <Input.TextArea
                                                value={draftAnalysis.sourceNotes || ""}
                                                autoSize={{ minRows: 2, maxRows: 5 }}
                                                maxLength={2_000}
                                                placeholder="必须保留的包装文字、颜色或结构"
                                                onChange={(event) => setDraftAnalysis((current) => ({ ...current, sourceNotes: event.target.value }))}
                                            />
                                        </Field>
                                    </div>
                                </div>
                            </section>

                            <section className="border-t border-stone-200 pt-7 dark:border-white/10">
                                <SectionHeading icon={<Layers3 className="size-4" />} title="视觉规划" />
                                <div className="mt-5 grid gap-6 xl:grid-cols-2">
                                    <div className="space-y-5">
                                        <Field label="目标平台">
                                            <Select value={activeProject.platform} options={PLATFORM_OPTIONS} className="w-full" disabled />
                                        </Field>
                                        <div>
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="text-xs font-medium text-stone-500">视觉风格</div>
                                                <div className="text-xs text-stone-400">{canUseMultipleStyles ? "最多同时选择 3 种" : "当前可选择 1 种"}</div>
                                            </div>
                                            <div className="mt-2 grid grid-cols-2 gap-2">
                                                {productStyleOptions.map((style) => {
                                                    const selected = selectedStyles.includes(style.value);
                                                    return (
                                                        <button
                                                            key={style.value}
                                                            type="button"
                                                            className={cn(
                                                                "min-h-16 border px-3 py-2 text-left transition",
                                                                selected
                                                                    ? "border-stone-950 bg-stone-950 text-white dark:border-[#c9a86a]/65 dark:bg-[#c9a86a]/10 dark:text-[#f0e5cc]"
                                                                    : "border-stone-200 hover:border-stone-400 dark:border-white/10 dark:hover:border-white/25",
                                                            )}
                                                            onClick={() => toggleStyle(style.value)}
                                                        >
                                                            <span className="block text-sm font-medium">{style.label}</span>
                                                            <span className="mt-1 block text-xs opacity-65">{style.description}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        {canUseBrand ? (
                                            <Field label="品牌信息">
                                                <Input value={brandName} maxLength={120} placeholder="可选，用于统一整套视觉表达" onChange={(event) => setBrandName(event.target.value)} />
                                            </Field>
                                        ) : null}
                                    </div>

                                    <div>
                                        <div className="text-xs font-medium text-stone-500">拼多多模板</div>
                                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                            {templates.map((template) => (
                                                <button
                                                    key={template.id}
                                                    type="button"
                                                    className="flex min-h-16 items-center justify-between gap-3 border border-stone-200 px-3 py-2 text-left transition hover:border-stone-400 dark:border-white/10 dark:hover:border-white/25"
                                                    onClick={() => applyTemplate(template)}
                                                >
                                                    <span>
                                                        <span className="block text-sm font-medium">{template.name}</span>
                                                        <span className="mt-1 block text-xs text-stone-500">
                                                            {template.aspectRatio} · {styleLabel(template.styleKey)}
                                                        </span>
                                                    </span>
                                                    <ImagePlus className="size-4 shrink-0 text-stone-400" />
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-7 border-t border-stone-200 pt-6 dark:border-white/10">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <div className="text-xs font-medium text-stone-500">统一视觉规范</div>
                                            <div className="mt-1 text-sm font-semibold">{activeVisualStyleGuide.styleName}</div>
                                        </div>
                                        <Tag bordered={false}>{styleLabel(selectedStyles[0] || "clean")}</Tag>
                                    </div>
                                    <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
                                        <VisualRule label="色彩" value={activeVisualStyleGuide.colorPalette} />
                                        <VisualRule label="背景体系" value={activeVisualStyleGuide.backgroundSystem} />
                                        <VisualRule label="光线与镜头" value={`${activeVisualStyleGuide.lighting}；${activeVisualStyleGuide.cameraLanguage}`} />
                                        <VisualRule label="禁止项" value={activeVisualStyleGuide.negativeStyleConstraints} />
                                    </div>
                                </div>

                                <div className="mt-6 flex justify-end">
                                    <Button type="primary" loading={savingPlan} icon={<Check className="size-4" />} onClick={savePlanning}>
                                        保存视觉规划
                                    </Button>
                                </div>
                            </section>

                            <section className="border-t border-stone-200 pt-7 dark:border-white/10 2xl:hidden">
                                <GenerationWorkbench
                                    outputs={outputs}
                                    selectedKinds={selectedKinds}
                                    onToggle={toggleOutput}
                                    plan={selectablePlanItems}
                                    selectedPlanIds={selectedPlanIds}
                                    onTogglePlan={togglePlanItem}
                                    model={model}
                                    config={effectiveConfig}
                                    onModelChange={(value) => updateConfig("imageModel", value)}
                                    onMissingConfig={() => openConfigDialog(true, "channels")}
                                    generations={generations}
                                    archivedAssetKeys={archivedAssetKeys}
                                    savingArchiveIds={savingArchiveIds}
                                    generating={generating}
                                    progress={generationProgress}
                                    actionLabel={realmExperience.actionLabel}
                                    generationBlockReason={generationBlockReason}
                                    onGenerate={generateSelectedPlan}
                                    onArchive={archiveGeneration}
                                />
                            </section>
                        </div>
                    ) : (
                        <div className="grid min-h-[520px] place-items-center">
                            <Empty
                                image={<Box className="mx-auto size-12 text-stone-300 dark:text-stone-600" />}
                                description={
                                    <div>
                                        <div className="text-sm font-medium text-stone-700 dark:text-stone-300">尚未放入商品</div>
                                        <div className="mt-1 text-xs text-stone-500">上传商品原图后，AI 会从真实信息开始规划。</div>
                                    </div>
                                }
                            >
                                <Button icon={<Upload className="size-4" />} onClick={() => fileInputRef.current?.click()}>
                                    上传商品图片
                                </Button>
                            </Empty>
                        </div>
                    )}
                </main>

                <aside className="hidden border-l border-stone-200 bg-white/45 p-5 dark:border-white/10 dark:bg-white/[0.015] 2xl:block">
                    {activeProject ? (
                        <GenerationWorkbench
                            outputs={outputs}
                            selectedKinds={selectedKinds}
                            onToggle={toggleOutput}
                            plan={selectablePlanItems}
                            selectedPlanIds={selectedPlanIds}
                            onTogglePlan={togglePlanItem}
                            model={model}
                            config={effectiveConfig}
                            onModelChange={(value) => updateConfig("imageModel", value)}
                            onMissingConfig={() => openConfigDialog(true, "channels")}
                            generations={generations}
                            archivedAssetKeys={archivedAssetKeys}
                            savingArchiveIds={savingArchiveIds}
                            generating={generating}
                            progress={generationProgress}
                            actionLabel={realmExperience.actionLabel}
                            generationBlockReason={generationBlockReason}
                            onGenerate={generateSelectedPlan}
                            onArchive={archiveGeneration}
                        />
                    ) : null}
                </aside>
            </div>
        </div>
    );
}

function GenerationWorkbench({
    outputs,
    selectedKinds,
    onToggle,
    plan,
    selectedPlanIds,
    onTogglePlan,
    model,
    config,
    onModelChange,
    onMissingConfig,
    generations,
    archivedAssetKeys,
    savingArchiveIds,
    generating,
    progress,
    actionLabel,
    generationBlockReason,
    onGenerate,
    onArchive,
}: {
    outputs: ReturnType<typeof availableProductOutputs>;
    selectedKinds: ProductOutputKind[];
    onToggle: (kind: ProductOutputKind) => void;
    plan: ProductPlanItem[];
    selectedPlanIds: readonly string[];
    onTogglePlan: (itemId: string) => void;
    model: string;
    config: ReturnType<typeof useEffectiveConfig>;
    onModelChange: (value: string) => void;
    onMissingConfig: () => void;
    generations: ProductGeneration[];
    archivedAssetKeys: ReadonlySet<string>;
    savingArchiveIds: readonly string[];
    generating: boolean;
    progress: GenerationProgress | null;
    actionLabel: string;
    generationBlockReason: string | null;
    onGenerate: () => void;
    onArchive: (generation: ProductGeneration) => Promise<void>;
}) {
    const succeededGenerations = generations
        .filter((generation) => generation.status === "succeeded" && generation.assetUrl)
        .slice()
        .reverse()
        .slice(0, 24);
    const generationColumns = productGenerationColumns(succeededGenerations);

    return (
        <div className="space-y-7">
            <section>
                <SectionHeading icon={<FlaskConical className="size-4" />} title="炼制内容" />
                <div className="mt-4">
                    <ProductOutputGrid outputs={outputs} selectedKinds={selectedKinds} onToggle={onToggle} />
                </div>
            </section>

            <section className="border-t border-stone-200 pt-6 dark:border-white/10">
                <div className="text-xs font-medium text-stone-500">生图模型</div>
                <div className="mt-2">
                    <ModelPicker config={config} value={model} onChange={onModelChange} capability="image" fullWidth onMissingConfig={onMissingConfig} />
                </div>
            </section>

            <section className="border-t border-stone-200 pt-6 dark:border-white/10">
                <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium text-stone-500">画卷规划</div>
                    <Tag bordered={false}>
                        已选 {selectedPlanIds.length}/{plan.length}
                    </Tag>
                </div>
                <div className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
                    {plan.length ? (
                        plan.map((item) => (
                            <div key={item.id} className="flex min-h-16 items-center gap-3 border-b border-stone-200/80 py-2 last:border-0 dark:border-white/8">
                                <Checkbox checked={selectedPlanIds.includes(item.id)} onChange={() => onTogglePlan(item.id)} aria-label={`选择${item.title}`} />
                                <span className="min-w-0 flex-1">
                                    <span className="flex min-w-0 items-center gap-2">
                                        <span className="min-w-0 truncate text-sm font-medium" title={item.title}>
                                            {item.title}
                                        </span>
                                        <span className="shrink-0 text-[10px] text-stone-400">{productSectionTypeLabel(item.sectionType)}</span>
                                    </span>
                                    <span className="mt-0.5 block truncate text-xs text-stone-500" title={item.description}>
                                        {item.description}
                                    </span>
                                </span>
                                <span className="shrink-0 text-[11px] text-stone-400">{item.aspectRatio}</span>
                            </div>
                        ))
                    ) : (
                        <div className="py-8 text-center text-xs text-stone-500">当前境界或模型下暂无可生成的商品页面。</div>
                    )}
                </div>
            </section>

            {generating && progress ? (
                <section className="border-t border-stone-200 pt-6 dark:border-white/10" aria-live="polite">
                    <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="min-w-0 truncate text-stone-600 dark:text-stone-300">天地法则正在演化：{progress.title}</span>
                        <span className="shrink-0 text-stone-400">
                            {progress.completed}/{progress.total}
                        </span>
                    </div>
                    <Progress className="mt-3" percent={progress.total ? Math.round((progress.completed / progress.total) * 100) : 0} showInfo={false} strokeColor="#b39155" />
                </section>
            ) : null}

            <section className="border-t border-stone-200 pt-6 dark:border-white/10">
                {generationBlockReason ? <div className="mb-3 text-xs leading-5 text-amber-700 dark:text-amber-300">{generationBlockReason}</div> : null}
                <Button type="primary" size="large" block loading={generating} disabled={!selectedPlanIds.length || Boolean(generationBlockReason)} icon={generating ? undefined : <Sparkles className="size-4" />} onClick={onGenerate}>
                    {generating ? "天地法则正在演化..." : `${actionLabel} · ${selectedPlanIds.length} 幅`}
                </Button>
            </section>

            <section className="border-t border-stone-200 pt-6 dark:border-white/10">
                <SectionHeading icon={<Archive className="size-4" />} title="已成画卷" />
                {succeededGenerations.length ? (
                    <div className="mt-4 grid grid-cols-2 items-start gap-2">
                        {generationColumns.map((column, columnIndex) => (
                            <div key={columnIndex} className="space-y-2">
                                {column.map((generation) => {
                                    const archived = Boolean(generation.assetKey && archivedAssetKeys.has(generation.assetKey));
                                    const saving = savingArchiveIds.includes(generation.id);
                                    return (
                                        <div key={generation.id} className="overflow-hidden border border-stone-200 bg-stone-100 dark:border-white/10 dark:bg-white/5">
                                            <div className="overflow-hidden bg-[linear-gradient(45deg,#ececea_25%,transparent_25%,transparent_75%,#ececea_75%),linear-gradient(45deg,#ececea_25%,transparent_25%,transparent_75%,#ececea_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] dark:bg-none" style={{ aspectRatio: productGenerationAspectRatio(generation.outputKind) }}>
                                                <img src={generation.assetUrl} alt={outputLabel(generation.outputKind)} className="size-full object-contain" loading="lazy" />
                                            </div>
                                            <div className="flex min-h-10 items-center justify-between gap-2 border-t border-stone-200 bg-white px-2 py-1.5 dark:border-white/10 dark:bg-stone-950/70">
                                                <span className="min-w-0 truncate text-[11px] text-stone-500">{productGenerationTitle("", generation)}</span>
                                                <Tooltip title={archived ? "已在藏卷阁" : "入藏卷阁"}>
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        className="h-7 shrink-0 px-1.5 text-xs"
                                                        icon={archived ? <Check className="size-3.5" /> : <FolderPlus className="size-3.5" />}
                                                        loading={saving}
                                                        disabled={archived || saving || !generation.assetKey}
                                                        onClick={() => void onArchive(generation)}
                                                    >
                                                        {archived ? "已入藏" : "入藏"}
                                                    </Button>
                                                </Tooltip>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="mt-4 py-7 text-center text-xs leading-5 text-stone-500">生成后的商品视觉会先保留在当前项目，你可以手动选择入藏卷阁。</div>
                )}
            </section>
        </div>
    );
}

function SectionHeading({ icon, title, action }: { icon: React.ReactNode; title: string; action?: React.ReactNode }) {
    return (
        <div className="flex h-8 items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
                {icon}
                {title}
            </div>
            {action}
        </div>
    );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
    return (
        <label className={className}>
            <span className="mb-2 block text-xs font-medium text-stone-500">{label}</span>
            {children}
        </label>
    );
}

function VisualRule({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 border-l-2 border-stone-300 pl-3 dark:border-white/15">
            <div className="text-[11px] font-medium text-stone-400">{label}</div>
            <div className="mt-1 line-clamp-4 text-xs leading-5 text-stone-600 dark:text-stone-300" title={value}>
                {value}
            </div>
        </div>
    );
}

function normalizeProjectAnalysis(project: ProductProject): ProductAnalysisDraft {
    const value = project.analysis && typeof project.analysis === "object" ? (project.analysis as Partial<ProductAnalysisDraft>) : {};
    return normalizeDraftAnalysis(
        {
            productName: textValue(value.productName) || project.title,
            category: textValue(value.category),
            subcategory: textValue(value.subcategory),
            material: textValue(value.material),
            color: textValue(value.color),
            styleTags: stringArray(value.styleTags, 8),
            targetAudience: textValue(value.targetAudience),
            usageScenarios: stringArray(value.usageScenarios, 8),
            titleSuggestion: textValue(value.titleSuggestion),
            sellingPoints: stringArray(value.sellingPoints, 8),
            differentiationPoints: stringArray(value.differentiationPoints, 8),
            userConcerns: stringArray(value.userConcerns, 8),
            recommendedFocusPoints: stringArray(value.recommendedFocusPoints, 8),
            additionalInformation: textValue(value.additionalInformation),
            visualDirection: textValue(value.visualDirection),
            visualStyleGuide: normalizeVisualStyleGuide(value.visualStyleGuide),
            complianceNotes: stringArray(value.complianceNotes, 8),
            detailSections: Array.isArray(value.detailSections)
                ? value.detailSections.slice(0, 8).map((item) => ({
                      type: productSectionTypeValue(item?.type),
                      title: textValue(item?.title),
                      objective: textValue(item?.objective),
                      copy: textValue(item?.copy),
                      prompt: textValue(item?.prompt),
                      negativeConstraints: stringArray(item?.negativeConstraints, 8),
                  }))
                : [],
            sourceNotes: textValue(value.sourceNotes),
        },
        project.title,
    );
}

function normalizeDraftAnalysis(value: ProductAnalysisDraft, fallbackTitle: string): ProductAnalysisDraft {
    return {
        productName: textValue(value.productName) || fallbackTitle || "未命名商品",
        category: textValue(value.category),
        subcategory: textValue(value.subcategory),
        material: textValue(value.material),
        color: textValue(value.color),
        styleTags: stringArray(value.styleTags, 8),
        targetAudience: textValue(value.targetAudience),
        usageScenarios: stringArray(value.usageScenarios, 8),
        titleSuggestion: textValue(value.titleSuggestion),
        sellingPoints: stringArray(value.sellingPoints, 8),
        differentiationPoints: stringArray(value.differentiationPoints, 8),
        userConcerns: stringArray(value.userConcerns, 8),
        recommendedFocusPoints: stringArray(value.recommendedFocusPoints, 8),
        additionalInformation: textValue(value.additionalInformation),
        visualDirection: textValue(value.visualDirection),
        visualStyleGuide: normalizeVisualStyleGuide(value.visualStyleGuide),
        complianceNotes: stringArray(value.complianceNotes, 8),
        detailSections: Array.isArray(value.detailSections)
            ? value.detailSections.slice(0, 8).map((item) => ({
                  type: productSectionTypeValue(item.type),
                  title: textValue(item.title),
                  objective: textValue(item.objective),
                  copy: textValue(item.copy),
                  prompt: textValue(item.prompt),
                  negativeConstraints: stringArray(item.negativeConstraints, 8),
              }))
            : [],
        sourceNotes: textValue(value.sourceNotes),
    };
}

function normalizeVisualStyleGuide(value: unknown) {
    const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    return {
        styleName: textValue(row.styleName),
        colorPalette: textValue(row.colorPalette),
        backgroundSystem: textValue(row.backgroundSystem),
        lighting: textValue(row.lighting),
        cameraLanguage: textValue(row.cameraLanguage),
        typography: textValue(row.typography),
        layoutRules: textValue(row.layoutRules),
        propRules: textValue(row.propRules),
        productRenderingRules: textValue(row.productRenderingRules),
        negativeStyleConstraints: textValue(row.negativeStyleConstraints),
    };
}

function productSectionTypeValue(value: unknown): ProductSectionType {
    const type = textValue(value) as ProductSectionType;
    return ["basic", "hero", "selling_points", "scenario", "detail_closeup", "specs", "material", "comparison", "brand_trust", "summary", "custom"].includes(type) ? type : "custom";
}

function inferProjectStyles(project: ProductProject) {
    const styles = Array.from(new Set((project.plan || []).map((item) => String(item.id || "").split(":", 1)[0]).filter((style) => productStyleOptions.some((item) => item.value === style)))).slice(0, 3);
    return styles.length ? styles : [project.styleKey || "clean"];
}

function hasProductAnalysis(project: ProductProject) {
    const analysis = project.analysis as Partial<ProductAnalysis>;
    return Boolean(textValue(analysis?.productName) && (stringArray(analysis?.sellingPoints, 8).length || textValue(analysis?.visualDirection)));
}

function textValue(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown, max: number) {
    return Array.isArray(value) ? value.map(textValue).filter(Boolean).slice(0, max) : [];
}

function lines(value: string, max: number) {
    return value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, max);
}

function productTitleFromFile(filename: string) {
    const title = filename
        .replace(/\.[^.]+$/, "")
        .replace(/[_-]+/g, " ")
        .trim();
    return (title || "未命名商品").slice(0, 120);
}

function outputLabel(kind: ProductOutputKind) {
    return productOutputDefinitions.find((item) => item.kind === kind)?.label || kind;
}

function styleLabel(styleKey: string) {
    return productStyleOptions.find((item) => item.value === styleKey)?.label || styleKey;
}

function projectStatusLabel(status: ProductProject["status"]) {
    return ({ draft: "待解析", analyzed: "已解析", planned: "已规划", completed: "已有作品" } as const)[status];
}

function productGenerationTitle(projectTitle: string, generation: ProductGeneration) {
    const output = outputLabel(generation.outputKind);
    const page = generation.outputKind === "detail_page" ? ` ${generation.pageIndex + 1}` : "";
    return projectTitle ? `${projectTitle} · ${output}${page}` : `${output}${page}`;
}

function productGenerationAspectRatio(kind: ProductOutputKind) {
    if (kind === "selling_poster" || kind === "detail_page") return "3 / 4";
    if (kind === "scene_image") return "4 / 3";
    return "1 / 1";
}

function productGenerationColumns(generations: ProductGeneration[]) {
    const columns: ProductGeneration[][] = [[], []];
    const heights = [0, 0];
    for (const generation of generations) {
        const columnIndex = heights[0] <= heights[1] ? 0 : 1;
        columns[columnIndex].push(generation);
        heights[columnIndex] += productGenerationHeightWeight(generation.outputKind);
    }
    return columns;
}

function productGenerationHeightWeight(kind: ProductOutputKind) {
    if (kind === "selling_poster" || kind === "detail_page") return 1.58;
    if (kind === "scene_image") return 1;
    return 1.25;
}
