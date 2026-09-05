import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Options } from "../../src/options/Options";
import { Popup } from "../../src/popup/Popup";
import { installChromeMock } from "../../src/test/chromeMock";
import { createProfile, getStore, getActiveProfileName, getProfileVersion } from "../../src/shared/storage";
import { scanPage } from "../../src/content/scanner";
import { mapFields } from "../../src/shared/fieldMatchers";
import { fillField } from "../../src/content/filler";
import { sampleProfile } from "../../src/shared/sampleProfile";

let root: Root | undefined;
let container: HTMLDivElement;
beforeEach(() => {
  vi.restoreAllMocks();
  installChromeMock();
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.append(container);
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.restoreAllMocks();
});
async function render(node: React.ReactNode) {
  root = createRoot(container);
  await act(async () => root!.render(node));
}
function button(label: string) {
  const found = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(label: string) { await act(async () => button(label).click()); }
function editor() { return container.querySelector("textarea")!; }
async function editName(name: string) {
  const profile = JSON.parse(editor().value);
  profile.personal.firstName = name;
  await act(async () => { Simulate.change(editor(), { target: { value: JSON.stringify(profile, null, 2) } } as any); });
  expect(button("Save").disabled).toBe(false);
}

describe("Profile editor behavior", () => {
  it.each(["Duplicate", "Rename", "New version", "Use for autofill"])("R21 %s silently discards unsaved profile content", async (action) => {
    const initial = await getStore();
    if (action === "Use for autofill") await createProfile("Second");
    await render(<Options />);
    if (action === "Use for autofill") {
      await act(async () => (container.querySelector(".version-item") as HTMLButtonElement).click());
    }
    await editName("Unsaved candidate");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.spyOn(window, "prompt").mockReturnValue("Changed name");
    await click(action);
    expect(confirm).not.toHaveBeenCalled();
    expect(editor().value).not.toContain("Unsaved candidate");
    expect((await getProfileVersion(initial.profiles[0].id))!.profile.personal.firstName).toBe("Alex");
    expect(button("Save").disabled).toBe(true);
  });

  it("Positive control: saving persists valid JSON and disables Save", async () => {
    await render(<Options />);
    await editName("Saved candidate");
    await click("Save");
    expect((await getStore()).profiles[0].profile.personal.firstName).toBe("Saved candidate");
    expect(container.querySelector('[role="status"]')!.textContent).toContain("Saved locally");
    expect(button("Save").disabled).toBe(true);
  });

  it("Positive control: malformed JSON stays editable and reports a validation error", async () => {
    await render(<Options />);
    await act(async () => Simulate.change(editor(), { target: { value: "{invalid" } } as any));
    await click("Save");
    expect(container.querySelector('[role="status"]')!.textContent).toContain("Not valid JSON");
    expect(editor().value).toBe("{invalid");
    expect((await getStore()).profiles[0].profile.personal.firstName).toBe("Alex");
  });

  it("Positive control: importing valid JSON creates and activates a named profile", async () => {
    await render(<Options />);
    const profile = structuredClone(sampleProfile);
    profile.personal.firstName = "Imported candidate";
    const file = { name: "Imported.profile.json", text: async () => JSON.stringify(profile) };
    await act(async () => Simulate.change(container.querySelector('input[type="file"]')!, { target: { files: [file], value: "" } } as any));
    expect(await getActiveProfileName()).toBe("Imported");
    expect(editor().value).toContain("Imported candidate");
  });

  it("Positive control: importing an invalid profile preserves the store", async () => {
    await render(<Options />);
    const file = { name: "Invalid.json", text: async () => "{}" };
    await act(async () => Simulate.change(container.querySelector('input[type="file"]')!, { target: { files: [file], value: "" } } as any));
    expect((await getStore()).profiles).toHaveLength(1);
    expect(container.querySelector('[role="status"]')!.textContent).toContain("not a valid profile");
  });

  it("R21 Export downloads saved content even when the editor has newer unsaved edits", async () => {
    await render(<Options />);
    await editName("New draft");
    let exported: Blob | undefined;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (blob: Blob) => { exported = blob; return "blob:test"; } });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await click("Export");
    const data = await new Promise<string>((resolveRead) => { const reader = new FileReader(); reader.onload = () => resolveRead(String(reader.result)); reader.readAsText(exported!); });
    expect(download).toHaveBeenCalledOnce();
    expect(JSON.parse(data).personal.firstName).toBe("Alex");
    expect(editor().value).toContain("New draft");
  });

  it("Positive control: deleting a selected profile keeps the remaining profile", async () => {
    await getStore();
    await createProfile("Disposable test version");
    await render(<Options />);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await click("Delete");
    expect((await getStore()).profiles.map((p) => p.name)).toEqual(["Default"]);
    expect(button("Delete").disabled).toBe(true);
  });

  it("Positive control: selecting another version respects cancellation of unsaved-edit warning", async () => {
    await getStore();
    await createProfile("Second");
    await render(<Options />);
    await editName("Keep draft");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => (container.querySelector(".version-item") as HTMLButtonElement).click());
    expect(confirm).toHaveBeenCalledOnce();
    expect(editor().value).toContain("Keep draft");
  });

  it("R22 editor close/reload has no beforeunload draft protection", async () => {
    const addListener = vi.spyOn(window, "addEventListener");
    await render(<Options />);
    await editName("Draft at risk");
    expect(addListener.mock.calls.filter(([type]) => type === "beforeunload")).toHaveLength(0);
    expect(window.onbeforeunload).toBeNull();
  });
});

describe("Popup routing", () => {
  function runtime(overrides: Record<string, unknown> = {}) {
    (chrome as any).runtime = { openOptionsPage: vi.fn() };
    (chrome as any).tabs = {
      query: vi.fn().mockResolvedValue([{ id: 7 }]),
      sendMessage: vi.fn().mockResolvedValue({ ok: true, detected: [] }),
      ...overrides
    };
    (chrome as any).scripting = { executeScript: vi.fn().mockResolvedValue([]) };
  }

  it("Positive control: missing content listener triggers injection and detection", async () => {
    runtime({ sendMessage: vi.fn().mockRejectedValueOnce(new Error("No receiver")).mockResolvedValueOnce({ ok: true, detected: [] }) });
    await render(<Popup />);
    await click("Show detected fields");
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ["contentScript.js"] });
    expect(container.querySelector('[role="status"]')!.textContent).toContain("Detected 0 fields");
  });

  it("Positive control: a restricted tab gives a recoverable error", async () => {
    runtime({ sendMessage: vi.fn().mockRejectedValue(new Error("No receiver")) });
    (chrome.scripting.executeScript as any).mockRejectedValue(new Error("Forbidden"));
    await render(<Popup />);
    await click("Autofill current page");
    expect(container.querySelector('[role="status"]')!.textContent).toContain("Cannot run on this page");
    expect(button("Autofill current page").disabled).toBe(false);
  });

  it("Positive control: selecting a profile updates persistent active selection", async () => {
    runtime();
    const first = await getStore();
    await createProfile("Second");
    await render(<Popup />);
    await act(async () => Simulate.change(container.querySelector("select")!, { target: { value: first.profiles[0].id } } as any));
    expect(await getActiveProfileName()).toBe("Default");
  });
});

describe("Actual React controlled form behavior", () => {
  it("R23 checked DOM state changes while React radio state remains unchanged", async () => {
    function Form() {
      const [answer, setAnswer] = useState("No");
      return <><fieldset><legend>Authorized to work in the United States?</legend>
        {["Yes", "No"].map((value) => <label key={value}><input type="radio" name="auth" value={value} checked={answer === value} onChange={() => setAnswer(value)} />{value}</label>)}
      </fieldset><output>{answer}</output></>;
    }
    await render(<Form />);
    const fields = scanPage();
    const mappings = mapFields(fields, sampleProfile);
    expect(mappings[0].confidence).toBe("high");
    await act(async () => { expect(fillField(mappings[0], fields[0], [])).toBe(true); });
    expect(container.querySelector<HTMLInputElement>('input[value="Yes"]')!.checked).toBe(true);
    expect(container.querySelector("output")!.textContent).toBe("No");
  });

  it("Positive control: native text setter does update React state", async () => {
    function Form() {
      const [name, setName] = useState("");
      return <><label>First name<input value={name} onChange={(event) => setName(event.target.value)} /></label><output>{name}</output></>;
    }
    await render(<Form />);
    const fields = scanPage();
    await act(async () => { fillField(mapFields(fields, sampleProfile)[0], fields[0], []); });
    expect(container.querySelector("output")!.textContent).toBe("Alex");
  });
});
