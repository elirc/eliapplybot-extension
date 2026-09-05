import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMock } from "../test/chromeMock";
import { createProfile, getStore, updateProfile, setActiveProfile, exportRawStore, getActiveVersion, restoreProfileStore } from "./storage";
import { sampleProfile } from "./sampleProfile";

let mock: ReturnType<typeof installChromeMock>;
beforeEach(() => { mock = installChromeMock(); });
describe("profile persistence regressions", () => {
  it("R14 preserves all raw versions when any entry is invalid", async () => {
    await getStore(); await createProfile("Second", sampleProfile);
    (mock.data.profileStore as any).profiles[1].profile.education[0].start.month = 99;
    const before = structuredClone(mock.data);
    await expect(getStore()).rejects.toThrow("preserved");
    expect(mock.data).toEqual(before); expect(await exportRawStore()).toEqual({ profileStore: before.profileStore });
  });
  it("R14 does not overwrite a newer-format store", async () => {
    mock.data.profileStore = { version: 99, important: "data" };
    await expect(getStore()).rejects.toThrow("preserved"); expect(mock.data.profileStore).toEqual({ version: 99, important: "data" });
  });
  it("R15 serializes concurrent first-run initialization and creation", async () => {
    await Promise.all([createProfile("A"), createProfile("B")]);
    expect((await getStore()).profiles.map((p) => p.name)).toEqual(["Default", "A", "B"]);
  });
  it("R15 keeps a saved profile when the active version changes concurrently", async () => {
    const first = (await getStore()).profiles[0]; const second = await createProfile("Second");
    const edited = structuredClone(sampleProfile); edited.personal.firstName = "Updated";
    await Promise.all([updateProfile(first.id, edited), setActiveProfile(second.id)]);
    const store = await getStore(); expect(store.profiles[0].profile.personal.firstName).toBe("Updated"); expect(store.activeId).toBe(second.id);
  });
  it("R15 rejects stale editor revisions", async () => {
    const first = (await getStore()).profiles[0];
    await updateProfile(first.id, sampleProfile, first.revision);
    await expect(updateProfile(first.id, sampleProfile, first.revision)).rejects.toThrow("another window");
  });
  it("R16 requires explicit review of a real profile", async () => {
    const first = (await getStore()).profiles[0]; expect(first.configured).toBe(false);
    await expect(updateProfile(first.id, sampleProfile, first.revision, true)).rejects.toThrow("sample contact");
    const real = structuredClone(sampleProfile); real.personal = { firstName: "Test", lastName: "Candidate", email: "candidate@example.net", phone: "", location: "", linkedin: "" };
    await updateProfile(first.id, real, first.revision, true); expect((await getActiveVersion()).configured).toBe(true);
    expect((await createProfile("Copy", real)).configured).toBe(false);
  });
  it("R14 restores a repaired backup, preserving raw data and invalidating old editors", async () => {
    const valid = await getStore(); const originalId = valid.activeId;
    mock.data.profileStore = { version: 99, important: "original" };
    await restoreProfileStore(valid);
    const restored = await getStore();
    expect(restored.profiles).toHaveLength(1); expect(restored.profiles[0].configured).toBe(false);
    expect(restored.activeId).not.toBe(originalId);
    expect((mock.data.profileRecoveryBackup as any).data.profileStore).toEqual({ version: 99, important: "original" });
    await expect(updateProfile(originalId, sampleProfile)).rejects.toThrow("no longer exists");
  });
  it("R14 refuses malformed recovery files without changing storage", async () => {
    await getStore(); const before = structuredClone(mock.data);
    await expect(restoreProfileStore({ version: 2, profiles: [] })).rejects.toThrow("preserved");
    expect(mock.data).toEqual(before);
  });
  it("R14 aborts replacement if the recovery backup cannot be saved", async () => {
    const valid = await getStore(); mock.data.profileStore = { version: 99, important: "original" };
    const original = structuredClone(mock.data);
    const set = vi.spyOn(chrome.storage.local, "set").mockRejectedValueOnce(new Error("Quota exceeded"));
    await expect(restoreProfileStore(valid)).rejects.toThrow("Quota exceeded"); expect(mock.data).toEqual(original); set.mockRestore();
  });
});
