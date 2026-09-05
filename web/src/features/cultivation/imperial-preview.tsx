import { Modal } from "antd";

import ImperialRealm from "./imperial-realm";

export default function ImperialPreview({ onClose }: { onClose: () => void }) {
    return (
        <Modal open onCancel={onClose} title="预览帝境" footer={null} width={960} centered styles={{ body: { overflow: "hidden" } }}>
            <ImperialRealm preview />
        </Modal>
    );
}
