import { useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input, InputNumber, Modal } from "antd";
import { useEffect, useId, useRef, useState } from "react";

import { friendlyErrorMessage } from "@/lib/friendly-error";
import { fetchAdminCultivationUsers, ServerRequestError, updateAdminImageBalance, type CultivationProfile } from "@/services/server-api";
import { useUserStore } from "@/stores/use-user-store";
import { UserIdentity } from "./user-identity";

type ImageBalanceInput = Parameters<typeof updateAdminImageBalance>[1];
type ImageBalanceValues = Omit<ImageBalanceInput, "adjustmentId">;
type BalanceUser = Pick<CultivationProfile, "userId" | "displayName" | "avatarUrl" | "paidImages">;

const unconfirmedMessage = "本次调整结果尚未确认，请重试确认，不会重复增减次数。可在本页重新打开，继续确认本次调整。";

function resultUnknown(error: unknown) {
    return !(error instanceof ServerRequestError) || error.status === 408 || error.status >= 500;
}

function balanceConflict(error: unknown) {
    return error instanceof ServerRequestError && error.status === 409 && error.code === "WALLET_BALANCE_CONFLICT";
}

// Keep an unconfirmed request through closing/reopening, only for this browser lifecycle.
export function createImageBalanceIntentStore() {
    const intents = new Map<string, Readonly<ImageBalanceInput>>();
    const key = (adminId: string, userId: string) => JSON.stringify([adminId, userId]);
    return {
        get: (adminId: string, userId: string) => intents.get(key(adminId, userId)),
        async submit(adminId: string, userId: string, values: ImageBalanceValues, send = updateAdminImageBalance) {
            if (!adminId) throw new Error("请重新登录后调整次数");
            const scope = key(adminId, userId);
            const retained = intents.get(scope);
            const input = retained ?? Object.freeze({ ...values, reason: values.reason?.trim() || undefined, adjustmentId: crypto.randomUUID() });
            intents.set(scope, input);
            const clear = () => {
                if (intents.get(scope)?.adjustmentId === input.adjustmentId) intents.delete(scope);
            };
            try {
                const result = await send(userId, input);
                clear();
                return result;
            } catch (error) {
                // Preflight rejections cannot establish a prior attempt's outcome. A balance
                // conflict is checked after the server's ledger lookup, so it proves no commit.
                if ((!retained && !resultUnknown(error)) || balanceConflict(error)) clear();
                throw error;
            }
        },
    };
}

const imageBalanceIntents = createImageBalanceIntentStore();

export function ImageBalanceModal({ user, onClose }: { user: BalanceUser; onClose: () => void }) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const adminId = useUserStore((state) => state.user?.id || "");
    const ownerRef = useRef(adminId);
    const [restoredIntent] = useState(() => imageBalanceIntents.get(adminId, user.userId));
    const [imageBalance, setImageBalance] = useState<number | null>(restoredIntent?.imageBalance ?? user.paidImages ?? 0);
    const [expectedBalance, setExpectedBalance] = useState(restoredIntent?.expectedImageBalance ?? user.paidImages ?? 0);
    const [reason, setReason] = useState(restoredIntent?.reason ?? "");
    const [pending, setPending] = useState<"save" | "reload" | null>(null);
    const [unknown, setUnknown] = useState(Boolean(restoredIntent));
    const [conflict, setConflict] = useState(false);
    const [error, setError] = useState(restoredIntent ? unconfirmedMessage : "");
    const errorRef = useRef<HTMLDivElement>(null);
    const savingRef = useRef(false);
    const inputId = useId();
    const valid = imageBalance !== null && Number.isSafeInteger(imageBalance) && imageBalance >= 0;
    const sameAdmin = Boolean(adminId && adminId === ownerRef.current);
    const isCurrentAdmin = () => sameAdmin && useUserStore.getState().user?.id === adminId;

    useEffect(() => {
        if (!sameAdmin) onClose();
    }, [sameAdmin, onClose]);
    useEffect(() => {
        if (error) {
            errorRef.current?.focus({ preventScroll: true });
            errorRef.current?.scrollIntoView({ block: "nearest" });
        }
    }, [error]);

    const save = async () => {
        if (!isCurrentAdmin() || savingRef.current || conflict || (!unknown && (!valid || imageBalance === expectedBalance))) return;
        savingRef.current = true;
        setPending("save");
        setError("");
        try {
            await imageBalanceIntents.submit(adminId, user.userId, { imageBalance: imageBalance!, expectedImageBalance: expectedBalance, reason });
            if (!isCurrentAdmin()) return;
            void queryClient.invalidateQueries({ queryKey: ["admin", "cultivation"] });
            void queryClient.invalidateQueries({ queryKey: ["cultivation", "profile"] });
            void queryClient.invalidateQueries({ queryKey: ["wallet"] });
            message.success("本次调整已确认");
            onClose();
        } catch (failure) {
            if (!isCurrentAdmin()) return;
            const stillUnknown = Boolean(imageBalanceIntents.get(adminId, user.userId));
            setUnknown(stillUnknown);
            if (!stillUnknown && balanceConflict(failure)) {
                setConflict(true);
                setError("可用次数已变化，本次调整未应用。请先读取最新次数，再确认调整后的次数。");
            } else setError(stillUnknown ? unconfirmedMessage : friendlyErrorMessage(failure, failure instanceof ServerRequestError ? failure.status : undefined));
        } finally {
            savingRef.current = false;
            setPending(null);
        }
    };

    const reload = async () => {
        if (!isCurrentAdmin() || savingRef.current || unknown) return;
        savingRef.current = true;
        setPending("reload");
        try {
            const result = await fetchAdminCultivationUsers(1, 20, user.userId);
            if (!isCurrentAdmin()) return;
            const latest = result.items.find((item) => item.userId === user.userId);
            if (!latest) throw new Error();
            setExpectedBalance(latest.paidImages ?? 0);
            setConflict(false);
            setError("");
        } catch {
            if (isCurrentAdmin()) setError("最新次数读取失败，请重试。");
        } finally {
            savingRef.current = false;
            setPending(null);
        }
    };

    const delta = valid ? imageBalance! - expectedBalance : 0;
    const locked = Boolean(pending) || unknown;
    const okText = unknown ? "重试确认" : !valid ? "设置次数" : imageBalance === expectedBalance ? "次数未变化" : `设置为 ${imageBalance!.toLocaleString()} 次`;
    return (
        <Modal title="调整灵卷次数" width={480} rootClassName="cultivation-admin-overlay cultivation-admin-balance-modal" open onCancel={() => !savingRef.current && onClose()} onOk={() => void save()} okText={okText} cancelText={unknown ? "稍后确认" : "取消"} confirmLoading={pending === "save"} okButtonProps={{ disabled: Boolean(pending) || !sameAdmin || conflict || (!unknown && (!valid || imageBalance === expectedBalance)) }} cancelButtonProps={{ disabled: Boolean(pending) }} closable={!pending} keyboard={!pending} mask={{ closable: !pending }}>
            <div className="cultivation-balance-owner"><UserIdentity user={user} /></div>
            <div className="cultivation-balance-current"><span>{unknown ? "本次调整前灵卷次数" : conflict ? "上次读取灵卷次数" : "当前灵卷次数"}</span><strong>{expectedBalance.toLocaleString()} 次</strong></div>
            <Form className="cultivation-balance-form" layout="vertical" onFinish={() => void save()}>
                <Form.Item label="调整后灵卷次数" htmlFor={inputId} extra={<span id={`${inputId}-help`}>填写 100，表示调整后灵卷次数为 100 次。</span>} validateStatus={!valid ? "error" : undefined} help={!valid ? <span id={`${inputId}-error`}>请输入不小于 0 的整数</span> : undefined}>
                    <InputNumber id={inputId} autoFocus min={0} max={Number.MAX_SAFE_INTEGER} precision={0} size="large" suffix="次" style={{ width: "100%" }} value={imageBalance} onChange={(value) => setImageBalance(typeof value === "number" ? value : null)} disabled={locked} aria-describedby={`${inputId}-help${!valid ? ` ${inputId}-error` : ""}`} onPressEnter={() => void save()} />
                </Form.Item>
                <p className="cultivation-balance-preview" aria-live="polite">{expectedBalance.toLocaleString()} 次 → {valid ? `${imageBalance!.toLocaleString()} 次（${delta === 0 ? "次数不变" : `${delta > 0 ? "增加" : "减少"} ${Math.abs(delta).toLocaleString()} 次`}）` : "待填写"}</p>
                <p className="mb-4 text-xs text-muted-foreground">可用次数不含运行中任务已占用的次数；生成失败后会退回占用次数。</p>
                <details className="mb-4" open={unknown && Boolean(reason) ? true : undefined}>
                    <summary className="cursor-pointer text-sm">调整说明（选填）</summary>
                    <Input.TextArea className="mt-3" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} rows={2} disabled={locked} aria-label="调整说明" placeholder="补充本次调整的背景" />
                </details>
                {error ? <div ref={errorRef} tabIndex={-1} role="alert" className="cultivation-balance-error"><p>{error}</p>{conflict ? <Button className="mt-2" onClick={() => void reload()} loading={pending === "reload"} disabled={Boolean(pending)}>读取最新次数</Button> : null}</div> : null}
            </Form>
        </Modal>
    );
}
