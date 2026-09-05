import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Popup, sendToActiveTab } from "./Popup";
import { installChromeMock } from "../test/chromeMock";
let root: Root;
beforeEach(() => { installChromeMock(); document.body.innerHTML = '<div id="root"></div>'; (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(document.getElementById("root")!); });
afterEach(async () => { await act(async () => root.unmount()); });
describe("popup actions", () => {
  it("disables autofill when setup is incomplete", async () => {
    await act(async () => root.render(<Popup />));
    expect(Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Autofill empty fields")!.disabled).toBe(true);
  });
  it("injects the content script only if ping fails", async () => {
    const sendMessage = vi.fn().mockRejectedValueOnce(new Error("No listener")).mockResolvedValueOnce({ ok: true, detected: [] });
    (chrome as any).tabs = { query: vi.fn().mockResolvedValue([{ id: 7 }]), sendMessage };
    (chrome as any).scripting = { executeScript: vi.fn().mockResolvedValue([]) };
    expect(await sendToActiveTab({ type: "EAM_DETECT" })).toMatchObject({ ok: true });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ["contentScript.js"] });
  });
  it("reports a restricted page without attempting a fill", async () => {
    (chrome as any).tabs = { query: vi.fn().mockResolvedValue([{ id: 7 }]), sendMessage: vi.fn().mockRejectedValue(new Error("No listener")) };
    (chrome as any).scripting = { executeScript: vi.fn().mockRejectedValue(new Error("Restricted")) };
    await expect(sendToActiveTab({ type: "EAM_AUTOFILL" })).rejects.toThrow("Cannot run");
  });
});
