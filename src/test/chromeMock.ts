import { performStoreOperation } from "../background/profileStore";
type StorageShape = Record<string, unknown>;
export function installChromeMock(): { data: StorageShape; reset: () => void } {
  const data: StorageShape = {};
  const changes = new Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>();
  const messages = new Set<(...args: any[]) => unknown>();
  const local = {
    async get(keys: string | string[] | null | undefined): Promise<StorageShape> {
      const wanted = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(wanted.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]));
    },
    async set(items: StorageShape): Promise<void> {
      const event: Record<string, chrome.storage.StorageChange> = {};
      for (const [key, value] of Object.entries(items)) { event[key] = { oldValue: structuredClone(data[key]), newValue: structuredClone(value) }; data[key] = structuredClone(value); }
      changes.forEach((listener) => listener(event, "local"));
    },
    async remove(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
  };
  const runtime = {
    id: "test-extension", getURL: (path: string) => `chrome-extension://test-extension/${path}`, openOptionsPage: async () => {},
    onInstalled: { addListener() {} },
    onMessage: { addListener: (listener: (...args: any[]) => unknown) => messages.add(listener), removeListener: (listener: (...args: any[]) => unknown) => messages.delete(listener) },
    async sendMessage(request: any): Promise<any> {
      if (request.type === "EAM_STORE") {
        try { return { ok: true, value: await performStoreOperation(request.operation) }; }
        catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
      }
      return new Promise((resolve, reject) => {
        let handled = false;
        messages.forEach((listener) => { if (listener(request, { id: "test-extension", url: runtime.getURL("popup.html") }, resolve) === true) handled = true; });
        if (!handled) reject(new Error("No message receiver."));
      });
    }
  };
  (globalThis as { chrome?: unknown }).chrome = { runtime, storage: { local, onChanged: { addListener: (fn: any) => changes.add(fn), removeListener: (fn: any) => changes.delete(fn) } } };
  return { data, reset() { for (const key of Object.keys(data)) delete data[key]; } };
}
