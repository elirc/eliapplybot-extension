import { beforeEach, describe, expect, it } from "vitest";
import { fillField, rollbackFilled, type RollbackEntry } from "./filler";
import { scanPage } from "./scanner";
import type { FieldMapping } from "../shared/types";

beforeEach(() => { document.body.innerHTML = ""; });
function fill(value: string, rollback: RollbackEntry[] = []) {
  const field = scanPage()[0];
  const mapping: FieldMapping = { fieldId: field.id, kind: "firstName", confidence: "high", reason: "test", value };
  return { ok: fillField(mapping, field, rollback), rollback };
}
describe("safe fill and rollback", () => {
  it("fills an empty input and notifies framework state", () => {
    document.body.innerHTML = "<input>";
    const events: string[] = []; const input = document.querySelector("input")!;
    input.addEventListener("input", () => events.push("input")); input.addEventListener("change", () => events.push("change"));
    const result = fill("Alex");
    expect(result.ok).toBe(true); expect(input.value).toBe("Alex"); expect(events).toEqual(["input", "change"]);
    expect(rollbackFilled(result.rollback)).toBe(1); expect(input.value).toBe("");
  });
  it("does not replace an existing answer", () => {
    document.body.innerHTML = '<input value="Original">';
    const result = fill("Changed"); expect(result.ok).toBe(false); expect(result.rollback).toHaveLength(0); expect(document.querySelector("input")!.value).toBe("Original");
  });
  it.each(['type="file"', 'type="password"', "readonly", "disabled"])("preserves protected controls: %s", (attribute) => {
    document.body.innerHTML = `<input ${attribute}>`; expect(fill("Alex").ok).toBe(false);
  });
  it("refuses empty values", () => { document.body.innerHTML = '<input>'; expect(fill("").ok).toBe(false); });
  it("does not record a failed select match", () => {
    document.body.innerHTML = '<select><option value="">Choose</option><option>Maybe</option></select>';
    const result = fill("Yes"); expect(result.ok).toBe(false); expect(result.rollback).toHaveLength(0);
  });
  it("selects exact option text and restores its empty placeholder", () => {
    document.body.innerHTML = '<select><option value="">Choose</option><option value="1">Yes</option></select>';
    const result = fill("Yes"); expect(result.ok).toBe(true); expect(document.querySelector("select")!.value).toBe("1");
    rollbackFilled(result.rollback); expect(document.querySelector("select")!.value).toBe("");
  });
  it("R10 prioritizes visible option labels over conflicting machine values", () => {
    document.body.innerHTML = '<select><option value="">Choose</option><option value="Yes">No</option><option value="affirmative">Yes</option></select>';
    expect(fill("Yes").ok).toBe(true); expect(document.querySelector("select")!.value).toBe("affirmative");
  });
  it("R10 leaves duplicate option labels for manual review", () => {
    document.body.innerHTML = '<select><option value="">Choose</option><option value="a">Yes</option><option value="b">Yes</option></select>';
    expect(fill("Yes").ok).toBe(false); expect(document.querySelector("select")!.value).toBe("");
  });
  it("R08 does not select options inside a disabled group", () => {
    document.body.innerHTML = '<select><option value="">Choose</option><optgroup label="Unavailable" disabled><option value="1">Yes</option></optgroup></select>';
    expect(fill("Yes").ok).toBe(false);
  });
  it("preserves manual edits made after fill", () => {
    document.body.innerHTML = '<input>'; const result = fill("Alex"); document.querySelector("input")!.value = "Manual";
    expect(rollbackFilled(result.rollback)).toBe(0); expect(document.querySelector("input")!.value).toBe("Manual");
  });
  it.each(["date", "month", "number"])("does not count a rejected %s assignment as a fill", (type) => {
    document.body.innerHTML = `<input type="${type}">`; expect(fill("09/2016").ok).toBe(false); expect(document.querySelector("input")!.value).toBe("");
  });
  it("restores rejected pattern values before emitting events", () => {
    document.body.innerHTML = '<input pattern="[0-9]+">'; expect(fill("Alex").ok).toBe(false); expect(document.querySelector("input")!.value).toBe("");
  });
  it("does not touch radio or consent choices", () => {
    document.body.innerHTML = '<fieldset><legend>Question</legend><label><input type="radio" name="a" value="Yes">Yes</label><label><input type="radio" name="a" value="No">No</label></fieldset>';
    expect(fill("Yes").ok).toBe(false); expect(document.querySelector("input")!.checked).toBe(false);
  });
});
