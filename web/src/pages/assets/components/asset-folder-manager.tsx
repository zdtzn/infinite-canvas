import { useState } from "react";
import { App, Button, Empty, Input, Modal, Select, Space, Tree } from "antd";
import { nanoid } from "nanoid";
import { assetFolderOptions, type AssetFolder } from "../../../../../shared/asset-folders";

type FolderTreeNode = { key: string; title: string; children: FolderTreeNode[] };

export function AssetFolderManager({ folders, busy, disabled, onSave }: { folders: AssetFolder[]; busy: boolean; disabled: boolean; onSave(folders: AssetFolder[]): Promise<void> }) {
    const { message, modal } = App.useApp();
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [parentId, setParent] = useState<string | null>(null);
    const tree = (parent: string | null): FolderTreeNode[] => folders.filter(folder => folder.parentId === parent).map(folder => ({ key: folder.id, title: folder.name, children: tree(folder.id) }));
    const save = async () => {
        try {
            const item = { id: editing || nanoid(), name, parentId };
            await onSave(editing ? folders.map(folder => folder.id === editing ? item : folder) : [...folders, item]);
            setName(""); setEditing(null); message.success("文件夹已保存");
        } catch (error) { message.error(error instanceof Error ? error.message : "文件夹保存失败"); }
    };
    const remove = () => {
        const folder = folders.find(item => item.id === editing);
        if (!folder) return;
        modal.confirm({ title: `删除文件夹“${folder.name}”？`, content: "其中的素材和子文件夹将移到上级，素材文件不会删除。", okText: "删除文件夹", cancelText: "取消", okButtonProps: { danger: true }, async onOk() {
            try {
                await onSave(folders.filter(item => item.id !== editing).map(item => item.parentId === editing ? { ...item, parentId: folder.parentId } : item));
                setEditing(null); setName(""); setParent(folder.parentId);
            } catch (error) { message.error(error instanceof Error ? error.message : "文件夹删除失败"); throw error; }
        } });
    };
    return <>
        <Button type="text" disabled={disabled} onClick={() => setOpen(true)}>管理文件夹</Button>
        <Modal title="素材文件夹" open={open} onCancel={() => !busy && setOpen(false)} footer={null}>
            {folders.length ? <Tree treeData={tree(null)} selectedKeys={editing ? [editing] : []} onSelect={keys => {
                if (busy) return;
                const folder = folders.find(item => item.id === keys[0]);
                setEditing(folder?.id || null); setName(folder?.name || ""); setParent(folder?.parentId || null);
            }} /> : <Empty description="新建文件夹，按项目整理素材" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            <Space orientation="vertical" className="mt-5 w-full">
                <Input aria-label="文件夹名称" value={name} maxLength={80} disabled={busy} placeholder="文件夹名称" onChange={event => setName(event.target.value)} />
                <Select aria-label="上级文件夹" className="w-full" value={parentId || ""} disabled={busy} onChange={value => setParent(value || null)} options={[{ value: "", label: "根目录" }, ...assetFolderOptions(folders).filter(item => item.value !== editing)]} />
                <Space wrap>
                    <Button type="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>{editing ? "保存修改" : "创建文件夹"}</Button>
                    <Button disabled={busy} onClick={() => { setParent(editing); setEditing(null); setName(""); }}>新建子文件夹</Button>
                    {editing && <Button type="text" danger disabled={busy} onClick={remove}>删除文件夹</Button>}
                </Space>
            </Space>
        </Modal>
    </>;
}
