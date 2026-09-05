import "fake-indexeddb/auto";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendChunk, createRecording, deleteRecording, finishRecording, getRecordingBlob, importRecording, listRecordings, MAX_AUDIO_BYTES, validateAudioImport } from "./database";

beforeEach(async () => {
  // fake-indexeddb uses structuredClone; native blobs support it while jsdom blobs do not.
  vi.stubGlobal("Blob", NodeBlob); vi.stubGlobal("File", NodeFile);
  for (const entry of await listRecordings()) await deleteRecording(entry.id);
});
afterEach(() => vi.unstubAllGlobals());
describe("local audio database", () => {
  it("keeps chunks ordered and metadata consistent across concurrent appends", async () => {
    const entry = await createRecording("microphone", "audio/webm");
    await Promise.all([appendChunk(entry.id, new Blob(["a"])), appendChunk(entry.id, new Blob(["b"]))]); await finishRecording(entry.id, 2000);
    const [saved] = await listRecordings(); expect(saved).toMatchObject({ bytes: 2, chunks: 2, status: "saved", durationMs: 2000 }); expect(await (await getRecordingBlob(saved)).text()).toBe("ab");
  });
  it("preserves earlier chunks after the recording limit is reached", async () => {
    const entry = await createRecording("microphone", "audio/webm"); await appendChunk(entry.id, new Blob(["saved"]));
    await expect(appendChunk(entry.id, { size: MAX_AUDIO_BYTES } as Blob)).rejects.toThrow("250 MB");
    const [saved] = await listRecordings(); expect(saved.bytes).toBe(5); expect(await (await getRecordingBlob(saved)).text()).toBe("saved");
  });
  it("imports a phone recording without changing its bytes", async () => {
    const file = new File(["synthetic audio bytes"], "call.m4a", { type: "audio/mp4" }); await importRecording(file);
    const [entry] = await listRecordings(); expect(entry).toMatchObject({ source: "import", status: "saved", name: "call.m4a" }); expect(await (await getRecordingBlob(entry)).text()).toBe("synthetic audio bytes");
  });
  it("removes metadata and chunks on delete", async () => {
    const entry = await createRecording("tab", "audio/webm"); await appendChunk(entry.id, new Blob(["private"])); await deleteRecording(entry.id);
    expect(await listRecordings()).toEqual([]); expect((await getRecordingBlob(entry)).size).toBe(0);
  });
  it("retains unfinished chunks for recovery", async () => {
    const entry = await createRecording("microphone", "audio/webm"); await appendChunk(entry.id, new Blob(["partial"]));
    const [saved] = await listRecordings(); expect(saved.status).toBe("recording"); expect((await getRecordingBlob(saved)).size).toBe(7);
  });
  it.each([{ size: 0, type: "audio/mp4", name: "empty.m4a" }, { size: MAX_AUDIO_BYTES + 1, type: "audio/mp4", name: "large.m4a" }, { size: 5, type: "text/plain", name: "note.txt" }])("rejects invalid imports: $name", (file) => { expect(() => validateAudioImport(file)).toThrow(); });
});
