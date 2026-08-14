export type IndexedDbStoreUsage = { name: string; records: number; bytes: number };
export type IndexedDbDatabaseUsage = { name: string; version: number; bytes: number; stores: IndexedDbStoreUsage[] };
export type LocalStorageUsage = { usage: number; quota: number; contentBytes: number; databases: IndexedDbDatabaseUsage[] };

export async function readLocalStorageUsage(): Promise<LocalStorageUsage> {
    if (typeof indexedDB === "undefined") throw new Error("当前浏览器不支持本地存储诊断");

    const estimate = typeof navigator !== "undefined" && navigator.storage?.estimate ? await navigator.storage.estimate() : {};
    const database = await readDatabaseUsage("infinite-canvas");
    return {
        usage: Number(estimate.usage || 0),
        quota: Number(estimate.quota || 0),
        contentBytes: database.bytes,
        databases: [database],
    };
}

function readDatabaseUsage(name: string) {
    return new Promise<IndexedDbDatabaseUsage>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error || new Error("无法读取本地数据库"));
        request.onsuccess = () => {
            const database = request.result;
            const names = Array.from(database.objectStoreNames);
            if (!names.length) {
                database.close();
                resolve({ name, version: database.version, bytes: 0, stores: [] });
                return;
            }

            try {
                const transaction = database.transaction(names, "readonly");
                Promise.all(names.map((storeName) => readStoreUsage(transaction.objectStore(storeName))))
                    .then((stores) => resolve({ name, version: database.version, bytes: stores.reduce((total, store) => total + store.bytes, 0), stores: stores.sort((left, right) => right.bytes - left.bytes) }))
                    .catch(reject)
                    .finally(() => database.close());
            } catch (error) {
                database.close();
                reject(error);
            }
        };
    });
}

function readStoreUsage(store: IDBObjectStore) {
    return new Promise<IndexedDbStoreUsage>((resolve, reject) => {
        let records = 0;
        let bytes = 0;
        const request = store.openCursor();
        request.onerror = () => reject(request.error || new Error(`无法读取存储区 ${store.name}`));
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve({ name: store.name, records, bytes });
                return;
            }
            records += 1;
            bytes += valueBytes(cursor.value);
            cursor.continue();
        };
    });
}

function valueBytes(value: unknown) {
    if (value instanceof Blob) return value.size;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    try {
        return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
    } catch {
        return 0;
    }
}
