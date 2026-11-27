import { App, Button } from "antd";
import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export function usePromptAdoption(draft: string, onChange: (value: string) => void, owner: string) {
    const { modal } = App.useApp();
    const confirmation = useRef<ReturnType<typeof modal.confirm> | null>(null);

    useEffect(() => () => confirmation.current?.destroy(), [draft, owner]);

    return useCallback((prompt: string) => {
        confirmation.current?.destroy();
        if (!draft.trim()) {
            onChange(prompt);
            return;
        }

        const dialog = modal.confirm({
            title: "使用提示词",
            content: "当前已有草稿。插入会将新提示词加到草稿末尾。",
            okText: "插入",
            cancelText: "取消",
            focusable: { autoFocusButton: "cancel" },
            onOk: () => onChange(`${draft}\n\n${prompt}`),
            footer: (_buttons, { CancelBtn, OkBtn }) => (
                <>
                    <CancelBtn />
                    <Button onClick={() => {
                        onChange(prompt);
                        dialog.destroy();
                    }}>替换</Button>
                    <OkBtn />
                </>
            ),
        });
        confirmation.current = dialog;
    }, [draft, modal, onChange]);
}

export function usePromptTransfer(onSelect: (prompt: string) => void) {
    const location = useLocation();
    const navigate = useNavigate();
    const consumedKey = useRef("");

    useEffect(() => {
        const state = location.state;
        if (!state || typeof state.promptTransfer !== "string" || consumedKey.current === location.key) return;
        consumedKey.current = location.key;
        const { promptTransfer, ...remainingState } = state;
        onSelect(promptTransfer);
        navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: remainingState });
    }, [location, navigate, onSelect]);
}
