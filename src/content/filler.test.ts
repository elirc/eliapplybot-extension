import { beforeEach, describe, expect, it } from "vitest";
import { fillField, rollbackFilled, type RollbackEntry } from "./filler";
import type { DetectedField, FieldMapping } from "../shared/types";

const FIELD_ID_ATTR = "data-eli-apply-mate-field-id";

function mapping(partial: Partial<FieldMapping>): FieldMapping {
  return {
    fieldId: "f-1",
    kind: "firstName",
    confidence: "high",
    reason: "test",
    ...partial
  };
}

function detected(partial: Partial<DetectedField>): DetectedField {
  return {
    id: "f-1",
    elementType: "input",
    labelText: "",
    ...partial
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("fillField", () => {
  it("fills a text input, dispatches events, and records rollback", async () => {
    document.body.innerHTML = `<input ${FIELD_ID_ATTR}="f-1" value="old" />`;
    const input = document.querySelector("input")!;
    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));

    const rollback: RollbackEntry[] = [];
    const ok = await fillField(mapping({ value: "Alex" }), detected({}), rollback);

    expect(ok).toBe(true);
    expect(input.value).toBe("Alex");
    expect(events).toEqual(["input", "change"]);
    expect(rollback).toHaveLength(1);
    expect(rollback[0].value).toBe("old");
  });

  it("does not record rollback when a select has no matching option", async () => {
    document.body.innerHTML = `
      <select ${FIELD_ID_ATTR}="f-1">
        <option value="">Select one</option>
        <option>Maybe</option>
      </select>`;
    const select = document.querySelector("select")!;
    let changed = 0;
    select.addEventListener("change", () => changed++);

    const rollback: RollbackEntry[] = [];
    const ok = await fillField(mapping({ value: "Yes" }), detected({ elementType: "select" }), rollback);

    expect(ok).toBe(false);
    expect(rollback).toHaveLength(0);
    expect(changed).toBe(0);
    expect(select.value).toBe("");
  });

  it("fills a select when an option matches by text", async () => {
    document.body.innerHTML = `
      <select ${FIELD_ID_ATTR}="f-1">
        <option value="">Select one</option>
        <option>Yes</option>
        <option>No</option>
      </select>`;
    const select = document.querySelector("select")!;

    const rollback: RollbackEntry[] = [];
    const ok = await fillField(mapping({ value: "No" }), detected({ elementType: "select" }), rollback);

    expect(ok).toBe(true);
    expect(select.value).toBe("No");
    expect(rollback).toHaveLength(1);
  });

  it("checks the radio whose label matches the value", async () => {
    document.body.innerHTML = `
      <label><input type="radio" name="auth" value="1" ${FIELD_ID_ATTR}="f-1" /> Yes</label>
      <label><input type="radio" name="auth" value="2" ${FIELD_ID_ATTR}="f-1" /> No</label>`;
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>("input"));

    const rollback: RollbackEntry[] = [];
    const ok = await fillField(mapping({ value: "Yes" }), detected({ elementType: "radio" }), rollback);

    expect(ok).toBe(true);
    expect(radios[0].checked).toBe(true);
    expect(radios[1].checked).toBe(false);
  });

  it("refuses to touch file inputs", async () => {
    document.body.innerHTML = `<input type="file" ${FIELD_ID_ATTR}="f-1" />`;
    const rollback: RollbackEntry[] = [];
    const ok = await fillField(mapping({ value: "resume.pdf" }), detected({ inputType: "file" }), rollback);
    expect(ok).toBe(false);
    expect(rollback).toHaveLength(0);
  });
});

describe("rollbackFilled", () => {
  it("restores original values and empties the entry list", async () => {
    document.body.innerHTML = `
      <input ${FIELD_ID_ATTR}="f-1" value="original" />
      <select ${FIELD_ID_ATTR}="f-2">
        <option value="">Select one</option>
        <option>Yes</option>
      </select>`;
    const input = document.querySelector("input")!;
    const select = document.querySelector("select")!;

    const rollback: RollbackEntry[] = [];
    await fillField(mapping({ fieldId: "f-1", value: "changed" }), detected({ id: "f-1" }), rollback);
    await fillField(mapping({ fieldId: "f-2", value: "Yes" }), detected({ id: "f-2", elementType: "select" }), rollback);

    expect(input.value).toBe("changed");
    expect(select.value).toBe("Yes");

    const count = rollbackFilled(rollback);
    expect(count).toBe(2);
    expect(input.value).toBe("original");
    expect(select.value).toBe("");
    expect(rollback).toHaveLength(0);
  });

  it("restores radio checked state", async () => {
    document.body.innerHTML = `
      <label><input type="radio" name="auth" checked value="1" ${FIELD_ID_ATTR}="f-1" /> No</label>
      <label><input type="radio" name="auth" value="2" ${FIELD_ID_ATTR}="f-1" /> Yes</label>`;
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>("input"));

    const rollback: RollbackEntry[] = [];
    await fillField(mapping({ value: "Yes" }), detected({ elementType: "radio" }), rollback);
    expect(radios[1].checked).toBe(true);

    rollbackFilled(rollback);
    expect(radios[0].checked).toBe(true);
    expect(radios[1].checked).toBe(false);
  });
});

describe("choice activation", () => {
  it("activates a radio with a real click, which is the only thing React listens for", async () => {
    document.body.innerHTML = `
      <label><input type="radio" name="auth" value="1" ${FIELD_ID_ATTR}="f-1" /> Yes</label>
      <label><input type="radio" name="auth" value="2" ${FIELD_ID_ATTR}="f-1" /> No</label>`;
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
    const clicks: string[] = [];
    for (const radio of radios) radio.addEventListener("click", () => clicks.push(radio.value));

    const ok = await fillField(mapping({ value: "Yes" }), detected({ elementType: "radio" }), []);

    expect(ok).toBe(true);
    // React's change plugin subscribes to click on checkboxes and radios, not to
    // the input/change pair used for text fields; a value set without a click
    // looks chosen but submits blank.
    expect(clicks).toEqual(["1"]);
    expect(radios[0].checked).toBe(true);
  });

  it("activates a checkbox with a click", async () => {
    document.body.innerHTML = `<label><input type="checkbox" value="ack" ${FIELD_ID_ATTR}="f-1" /> Yes</label>`;
    const checkbox = document.querySelector<HTMLInputElement>("input")!;
    let clicks = 0;
    checkbox.addEventListener("click", () => (clicks += 1));

    const ok = await fillField(mapping({ value: "Yes" }), detected({ elementType: "checkbox" }), []);

    expect(ok).toBe(true);
    expect(clicks).toBe(1);
    expect(checkbox.checked).toBe(true);
  });

  it("falls back to the checked property when the click is cancelled", async () => {
    document.body.innerHTML = `<label><input type="checkbox" value="ack" ${FIELD_ID_ATTR}="f-1" /> Yes</label>`;
    const checkbox = document.querySelector<HTMLInputElement>("input")!;
    const events: string[] = [];
    // Overlay labels commonly cancel the click, which reverts `checked`.
    checkbox.addEventListener("click", (event) => event.preventDefault());
    checkbox.addEventListener("change", () => events.push("change"));

    const ok = await fillField(mapping({ value: "Yes" }), detected({ elementType: "checkbox" }), []);

    expect(ok).toBe(true);
    expect(checkbox.checked).toBe(true);
    expect(events).toEqual(["change"]);
  });
});

describe("button choice groups", () => {
  function buttonGroup(options: string[], type: "button" | "submit" = "button"): HTMLButtonElement[] {
    document.body.innerHTML = `
      <div class="ashby-application-form-input-yesno">
        ${options
          .map((text) => `<button type="${type}" aria-pressed="false" ${FIELD_ID_ATTR}="f-1">${text}</button>`)
          .join("")}
        <input type="checkbox" tabindex="-1" name="uuid" />
      </div>`;
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
    for (const button of buttons) {
      button.addEventListener("click", () => {
        for (const other of buttons) other.setAttribute("aria-pressed", String(other === button));
      });
    }
    return buttons;
  }

  it("presses the matching answer button and verifies aria-pressed", async () => {
    const [yes, no] = buttonGroup(["Yes", "No"]);
    const rollback: RollbackEntry[] = [];

    const ok = await fillField(mapping({ value: "No" }), detected({ elementType: "buttongroup" }), rollback);

    expect(ok).toBe(true);
    expect(no.getAttribute("aria-pressed")).toBe("true");
    expect(yes.getAttribute("aria-pressed")).toBe("false");
    // The decoy checkbox is never what we set: React does not read it back.
    expect(rollback).toHaveLength(1);
    expect(rollback[0].widget).toBe("buttons");
  });

  it("refuses a near match on a sponsorship question", async () => {
    const buttons = buttonGroup(["Yes, with sponsorship", "No"]);
    const rollback: RollbackEntry[] = [];

    const ok = await fillField(mapping({ value: "Yes" }), detected({ elementType: "buttongroup" }), rollback);

    expect(ok).toBe(false);
    expect(buttons.every((button) => button.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(rollback).toHaveLength(0);
  });

  it("never presses a button that would submit the form", async () => {
    const buttons = buttonGroup(["Yes", "No"], "submit");
    let clicks = 0;
    for (const button of buttons) button.addEventListener("click", () => (clicks += 1));

    const ok = await fillField(mapping({ value: "Yes" }), detected({ elementType: "buttongroup" }), []);

    expect(ok).toBe(false);
    expect(clicks).toBe(0);
  });

  it("restores the answer that was selected before", async () => {
    const [yes, no] = buttonGroup(["Yes", "No"]);
    yes.setAttribute("aria-pressed", "true");
    const rollback: RollbackEntry[] = [];

    await fillField(mapping({ value: "No" }), detected({ elementType: "buttongroup" }), rollback);
    expect(no.getAttribute("aria-pressed")).toBe("true");

    expect(rollbackFilled(rollback)).toBe(1);
    expect(yes.getAttribute("aria-pressed")).toBe("true");
    expect(no.getAttribute("aria-pressed")).toBe("false");
  });
});
