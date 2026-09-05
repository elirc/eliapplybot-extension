import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Options } from "./Options";
import { installChromeMock } from "../test/chromeMock";
import { createProfile, getStore, updateProfile } from "../shared/storage";
import { sampleProfile } from "../shared/sampleProfile";

let root: Root; let container: HTMLDivElement;
beforeEach(async () => {
  vi.restoreAllMocks(); installChromeMock(); localStorage.clear(); sessionStorage.clear(); document.body.innerHTML = "";
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const store = await getStore(); await updateProfile(store.activeId, sampleProfile);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); });
const render = async () => { await act(async () => root.render(<Options />)); };
function button(name: string): HTMLButtonElement { const found = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === name); if (!found) throw new Error(name); return found; }
const click = async (name: string) => { await act(async () => button(name).click()); };
const editor = () => container.querySelector("textarea")!;
const edit = async (text: string) => { await act(async () => Simulate.change(editor(), { target: { value: text } } as any)); };
async function editName(name: string) { const profile = JSON.parse(editor().value); profile.personal.firstName = name; await edit(JSON.stringify(profile)); }

describe("profile editor draft protection", () => {
  it.each(["Rename", "Use for autofill"])("R21 %s saves valid pending changes instead of losing them", async (action) => {
    if (action === "Use for autofill") { await createProfile("Second", sampleProfile); }
    await render(); await editName("Saved draft"); vi.spyOn(window, "prompt").mockReturnValue("Renamed");
    await click(action); expect(editor().value).toContain("Saved draft"); expect((await getStore()).profiles.some((p) => p.profile.personal.firstName === "Saved draft")).toBe(true);
  });
  it("R21 duplicates current draft content and preserves the original draft", async () => {
    await render(); await editName("Duplicated draft"); await click("Duplicate");
    expect(editor().value).toContain("Duplicated draft");
    const store = await getStore(); expect(store.profiles[0].profile.personal.firstName).toBe("Alex"); expect(store.profiles[1].profile.personal.firstName).toBe("Duplicated draft");
    expect(Object.keys(localStorage).some((key) => localStorage.getItem(key)?.includes("Duplicated draft"))).toBe(true);
  });
  it("R21 canceling new-version navigation retains unsaved content", async () => {
    await render(); await editName("Keep draft"); vi.spyOn(window, "prompt").mockReturnValue("New"); vi.spyOn(window, "confirm").mockReturnValue(false);
    await click("New version"); expect(editor().value).toContain("Keep draft"); expect((await getStore()).profiles).toHaveLength(1);
  });
  it("R21 canceling the name dialog retains the recoverable backup", async () => {
    await render(); await editName("Keep my backup"); vi.spyOn(window, "prompt").mockReturnValue(null);
    await click("New version");
    expect(Object.keys(localStorage).some((key) => localStorage.getItem(key)?.includes("Keep my backup"))).toBe(true);
  });
  it("R21 a failed new-version save retains the recoverable backup", async () => {
    await render(); await editName("Keep on failure"); vi.spyOn(window, "prompt").mockReturnValue("New"); vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(chrome.storage.local, "set").mockRejectedValueOnce(new Error("Storage unavailable"));
    await click("New version"); expect(editor().value).toContain("Keep on failure");
    expect(Object.keys(localStorage).some((key) => localStorage.getItem(key)?.includes("Keep on failure"))).toBe(true);
  });
  it("R21 exports the visible draft, including invalid JSON", async () => {
    await render(); await edit("{unfinished"); let exported: Blob | undefined;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (blob: Blob) => { exported = blob; return "blob:test"; } });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await click("Export");
    const text = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(exported!); });
    expect(text).toBe("{unfinished");
  });
  it("R22 protects navigation and restores a draft on remount", async () => {
    const listener = vi.spyOn(window, "addEventListener"); await render(); await editName("Recover me");
    expect(listener.mock.calls.some(([type]) => type === "beforeunload")).toBe(true);
    await act(async () => root.unmount()); root = createRoot(container); await render(); expect(editor().value).toContain("Recover me");
  });
  it("R22 finds and recovers a draft after the original editor session closes", async () => {
    await render(); await editName("Recover closed tab");
    await act(async () => root.unmount()); sessionStorage.clear(); root = createRoot(container); await render();
    expect(editor().value).not.toContain("Recover closed tab");
    await click("Find saved drafts"); await click("Recover draft"); expect(editor().value).toContain("Recover closed tab");
    await click("Save"); expect((await getStore()).profiles[0].profile.personal.firstName).toBe("Recover closed tab");
  });
  it("rejects invalid JSON without discarding it", async () => {
    await render(); await edit("{invalid"); await click("Save"); expect(editor().value).toBe("{invalid"); expect(container.querySelector('[role="status"]')!.textContent).toContain("Not valid JSON");
  });
  it("R15 rejects a stale save without replacing the draft", async () => {
    await render(); await editName("Local draft"); const store = await getStore();
    const other = structuredClone(sampleProfile); other.personal.firstName = "Other window";
    await act(async () => { await updateProfile(store.activeId, other); });
    await click("Save"); expect(container.querySelector('[role="status"]')!.textContent).toContain("another window"); expect(editor().value).toContain("Local draft");
    expect((await getStore()).profiles[0].profile.personal.firstName).toBe("Other window");
  });
  it("allows partial email editing without closing the guided editor", async () => {
    await render(); const input = Array.from(container.querySelectorAll(".profile-fields input")).find((e) => (e as HTMLInputElement).value === sampleProfile.personal.email)!;
    await act(async () => Simulate.change(input, { target: { value: "a" } } as any));
    expect(container.querySelector(".profile-fields")).not.toBeNull(); expect(editor().value).toContain('"email": "a"');
  });
});
