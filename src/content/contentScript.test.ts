import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMock } from "../test/chromeMock";
import { getStore, updateProfile } from "../shared/storage";
import { sampleProfile } from "../shared/sampleProfile";

beforeEach(async () => {
  vi.resetModules(); installChromeMock(); document.body.innerHTML = "";
  document.getElementById("eli-apply-mate-sidebar")?.remove(); delete window.__eliApplyMateLoaded;
  await import("./contentScript");
});
async function configured() {
  const id = (await getStore()).activeId;
  const profile = structuredClone(sampleProfile); profile.personal = { firstName: "Test", lastName: "Candidate", email: "test@example.net", phone: "", linkedin: "", location: "Private location" };
  await updateProfile(id, profile, undefined, true);
}
describe("content routing and review", () => {
  it("R16 blocks first-run autofill without touching the page", async () => {
    document.body.innerHTML = '<label>First name<input></label>';
    expect(await chrome.runtime.sendMessage({ type: "EAM_AUTOFILL" })).toMatchObject({ ok: false }); expect(document.querySelector("input")!.value).toBe("");
  });
  it("R19 detects fields without inserting stored values into page UI", async () => {
    await configured(); document.body.innerHTML = '<label>Location<input></label>';
    await chrome.runtime.sendMessage({ type: "EAM_DETECT" });
    expect(document.getElementById("eli-apply-mate-sidebar")!.shadowRoot!.textContent).not.toContain("Private location"); expect(document.querySelector("input")!.value).toBe("");
  });
  it("R18 recomputes the panel after undo and reports required fields", async () => {
    await configured(); document.body.innerHTML = '<label>First name<input required></label>';
    expect((await chrome.runtime.sendMessage({ type: "EAM_AUTOFILL" })).result.filled).toHaveLength(1);
    await chrome.runtime.sendMessage({ type: "EAM_CLEAR" });
    const response = await chrome.runtime.sendMessage({ type: "EAM_SHOW_LAST_RESULT" });
    expect(response.result.filled).toHaveLength(0); expect(response.result.missingRequired).toHaveLength(1); expect(document.querySelector("input")!.value).toBe("");
  });
  it("R17 a checked newsletter does not satisfy required consent", async () => {
    await configured(); document.body.innerHTML = '<form><label><input type="checkbox" checked>Newsletter</label><label><input type="checkbox" required>Accept terms</label></form>';
    const result = await chrome.runtime.sendMessage({ type: "EAM_AUTOFILL" }); expect(result.result.missingRequired).toHaveLength(1);
  });
  it("R17 honors aria-required and enabled radio options without counting read-only fields", async () => {
    await configured(); document.body.innerHTML = '<label><input type="checkbox" aria-required="true">Consent</label><fieldset><legend>Choose an option</legend><label><input type="radio" name="choice" disabled>Unavailable</label><label><input type="radio" name="choice" required>Available</label></fieldset><input required readonly aria-label="Assigned ID">';
    const response = await chrome.runtime.sendMessage({ type: "EAM_AUTOFILL" });
    expect(response.result.missingRequired).toHaveLength(2);
    expect(response.result.missingRequired.map((field: any) => field.elementType).sort()).toEqual(["checkbox", "radio"]);
  });
  it("R12 undo restores only the latest batch", async () => {
    await configured(); document.body.innerHTML = '<label>First name<input id="first"></label>';
    await chrome.runtime.sendMessage({ type: "EAM_AUTOFILL" });
    document.body.insertAdjacentHTML("beforeend", '<label>Last name<input id="last"></label>');
    await chrome.runtime.sendMessage({ type: "EAM_AUTOFILL" }); await chrome.runtime.sendMessage({ type: "EAM_CLEAR" });
    expect(document.querySelector<HTMLInputElement>("#first")!.value).toBe("Test"); expect(document.querySelector<HTMLInputElement>("#last")!.value).toBe("");
  });
  it("handles missing review and escapes hostile labels", async () => {
    expect(await chrome.runtime.sendMessage({ type: "EAM_SHOW_LAST_RESULT" })).toMatchObject({ ok: false });
    document.body.innerHTML = '<label>&lt;img src=x onerror=alert(1)&gt;<input></label>';
    await chrome.runtime.sendMessage({ type: "EAM_DETECT" });
    expect(document.getElementById("eli-apply-mate-sidebar")!.shadowRoot!.querySelector("img")).toBeNull();
  });
});
