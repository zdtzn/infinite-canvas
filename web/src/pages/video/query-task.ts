// Retry only status reads. This helper must never submit a new generation task.
export async function queryVideoTask<T>(read: () => Promise<T>, wait: (ms: number) => Promise<unknown>, isCurrent: () => boolean) {
    for (let attempt = 0; ; attempt += 1) {
        if (!isCurrent()) throw new DOMException("Aborted", "AbortError");
        try { return await read(); } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            if (!isCurrent() || attempt >= 2 || /401|403|404|凭证|认证|权限|账号|配置/i.test(detail)) throw error;
            await wait(1500 * (attempt + 1));
        }
    }
}
