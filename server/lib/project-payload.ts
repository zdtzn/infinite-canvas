const RECORD_ID_PATTERN = /^[A-Za-z0-9._-]{1,180}$/;
const NODE_ID_PATTERN = /^[A-Za-z0-9._-]+(?::[A-Za-z0-9._-]+)+$/;
const RESERVED_RECORD_IDS = new Set(["__proto__", "prototype", "constructor"]);

export function isValidProjectPayload(value: unknown, id: string): value is Record<string, unknown> {
    if (!isSafeRecordId(id) || !value || typeof value !== "object" || Array.isArray(value)) return false;
    const project = value as Record<string, unknown>;
    if (project.id !== id || typeof project.title !== "string" || project.title.length > 160 || /\p{C}/u.test(project.title)) return false;
    if (!Array.isArray(project.nodes) || !Array.isArray(project.connections) || project.nodes.length > 1_000 || project.connections.length > 4_000) return false;
    const nodeIds = new Set<string>();
    for (const node of project.nodes) {
        if (!node || typeof node !== "object" || Array.isArray(node)) return false;
        const record = node as Record<string, unknown>;
        const nodeId = record.id;
        // Plugin nodes use a type prefix such as director:studio. Only project and connection IDs use the path-safe record format.
        if (!(isSafeRecordId(nodeId) || (typeof nodeId === "string" && nodeId.length <= 180 && NODE_ID_PATTERN.test(nodeId))) || nodeIds.has(nodeId)) return false;
        nodeIds.add(nodeId);
    }
    const connectionIds = new Set<string>();
    for (const connection of project.connections) {
        if (!connection || typeof connection !== "object" || Array.isArray(connection)) return false;
        const record = connection as Record<string, unknown>;
        if (
            !isSafeRecordId(record.id) ||
            connectionIds.has(record.id) ||
            typeof record.fromNodeId !== "string" ||
            typeof record.toNodeId !== "string" ||
            !nodeIds.has(record.fromNodeId) ||
            !nodeIds.has(record.toNodeId)
        ) {
            return false;
        }
        connectionIds.add(record.id);
    }
    return true;
}

export function isSafeRecordId(value: unknown): value is string {
    return typeof value === "string" && RECORD_ID_PATTERN.test(value) && !RESERVED_RECORD_IDS.has(value.toLowerCase());
}
