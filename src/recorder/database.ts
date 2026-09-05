export type Recording = {
  id: string; name: string; source: "microphone" | "tab" | "import";
  mimeType: string; createdAt: string; bytes: number; chunks: number;
  status: "recording" | "saved" | "interrupted"; durationMs: number;
};
export const MAX_AUDIO_BYTES = 250 * 1024 * 1024;
const DB_NAME = "eli-apply-mate-audio";
let connection: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("recordings", { keyPath: "id" });
      request.result.createObjectStore("chunks", { keyPath: ["recordingId", "index"] });
    };
    request.onerror = () => { connection = undefined; reject(request.error); };
    request.onblocked = () => { connection = undefined; reject(new Error("Close other recorder tabs and try again.")); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = undefined; };
      resolve(db);
    };
  });
  return connection;
}
function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error ?? new Error("Recording storage failed.")); transaction.onabort = () => reject(transaction.error ?? new Error("Recording storage was interrupted.")); });
}
function result<T>(request: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
export async function createRecording(source: Recording["source"], mimeType: string, name?: string): Promise<Recording> {
  const entry: Recording = { id: crypto.randomUUID(), name: name || `Recording ${new Date().toLocaleString()}`, source, mimeType, createdAt: new Date().toISOString(), bytes: 0, chunks: 0, status: "recording", durationMs: 0 };
  const db = await database(); const tx = db.transaction("recordings", "readwrite");
  tx.objectStore("recordings").add(entry); await complete(tx); return entry;
}
export async function appendChunk(id: string, blob: Blob): Promise<void> {
  if (!blob.size) return;
  const db = await database(); const tx = db.transaction(["recordings", "chunks"], "readwrite"); const done = complete(tx);
  const metadata = tx.objectStore("recordings"); const get = metadata.get(id);
  let failure: Error | undefined;
  get.onsuccess = () => {
    const entry = get.result as Recording | undefined;
    if (!entry || entry.bytes + blob.size > MAX_AUDIO_BYTES) { failure = new Error(entry ? "Recording reached the 250 MB limit. Earlier audio has been preserved." : "Recording no longer exists."); tx.abort(); return; }
    tx.objectStore("chunks").add({ recordingId: id, index: entry.chunks, blob });
    metadata.put({ ...entry, chunks: entry.chunks + 1, bytes: entry.bytes + blob.size });
  };
  try { await done; } catch (error) { throw failure ?? error; }
}
export async function finishRecording(id: string, durationMs: number, interrupted = false): Promise<void> {
  const db = await database(); const tx = db.transaction("recordings", "readwrite"); const done = complete(tx);
  const store = tx.objectStore("recordings"); const get = store.get(id);
  get.onsuccess = () => { if (get.result) store.put({ ...get.result, durationMs, status: interrupted ? "interrupted" : "saved" }); };
  await done;
}
export async function listRecordings(): Promise<Recording[]> {
  const db = await database(); const entries = await result<Recording[]>(db.transaction("recordings").objectStore("recordings").getAll());
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function getRecordingBlob(entry: Recording): Promise<Blob> {
  const db = await database(); const chunks = await result<Array<{ blob: Blob }>>(db.transaction("chunks").objectStore("chunks").getAll(IDBKeyRange.bound([entry.id, 0], [entry.id, Number.MAX_SAFE_INTEGER])));
  return new Blob(chunks.map((chunk) => chunk.blob), { type: entry.mimeType });
}
export async function deleteRecording(id: string): Promise<void> {
  const db = await database(); const tx = db.transaction(["recordings", "chunks"], "readwrite");
  tx.objectStore("recordings").delete(id); tx.objectStore("chunks").delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])); await complete(tx);
}
export function validateAudioImport(file: Pick<File, "size" | "type" | "name">): void {
  if (!file.size) throw new Error("This audio file is empty.");
  if (file.size > MAX_AUDIO_BYTES) throw new Error("Choose an audio file smaller than 250 MB.");
  if ((!file.type.startsWith("audio/") && file.type !== "video/webm" && file.type !== "") || !/\.(webm|m4a|mp3|wav|ogg|oga|aac|flac|mp4)$/i.test(file.name)) throw new Error("Choose an audio recording (WebM, M4A, MP3, WAV, OGG, AAC or FLAC).");
}
export async function importRecording(file: File): Promise<Recording> {
  validateAudioImport(file);
  const mimeType = file.type || ({ m4a: "audio/mp4", mp4: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", aac: "audio/aac", flac: "audio/flac", webm: "audio/webm" } as Record<string, string>)[file.name.split(".").pop()!.toLowerCase()];
  const entry = await createRecording("import", mimeType, file.name);
  try { await appendChunk(entry.id, file); await finishRecording(entry.id, 0); return { ...entry, bytes: file.size, chunks: 1, status: "saved" }; }
  catch (error) { await deleteRecording(entry.id); throw error; }
}
