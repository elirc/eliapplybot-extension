import type { DetectedField, FieldMapping } from "../shared/types";
import { normalizeText } from "../shared/fieldMatchers";
import { findFieldElements, isVisible } from "./scanner";
import { isInput, isSelect, type Control } from "./domLabels";

export type RollbackEntry = { fieldId: string; element: Control; value: string; afterValue: string };
const editable = (element: Control) => isVisible(element) && !element.matches(":disabled") && !element.hasAttribute("readonly") && element.getAttribute("aria-readonly") !== "true" && element.getAttribute("role") !== "combobox";
export function fillField(mapping: FieldMapping, field: DetectedField, rollback: RollbackEntry[]): boolean {
  if (mapping.confidence !== "high" || !mapping.value?.trim() || field.disabled || field.readOnly) return false;
  const elements = findFieldElements(mapping.fieldId);
  if (elements.length !== 1 || !editable(elements[0])) return false;
  const element = elements[0];
  if (isInput(element) && ["file", "password", "hidden", "submit", "button", "reset", "image", "checkbox", "radio"].includes(element.type)) return false;
  // A scan cannot authorize replacing anything typed since the scan occurred.
  if (element.value.trim()) return false;
  let value = mapping.value;
  if (isSelect(element)) {
    if (element.multiple) return false;
    const options = Array.from(element.options).filter((o) => !o.disabled && !(o.parentElement?.tagName === "OPTGROUP" && o.parentElement.hasAttribute("disabled")));
    const labelMatches = options.filter((o) => normalizeText(o.text) === normalizeText(value));
    const matches = labelMatches.length ? labelMatches : options.filter((o) => normalizeText(o.value) === normalizeText(value));
    const option = matches.length === 1 ? matches[0] : undefined;
    if (!option || !option.value) return false;
    value = option.value;
  }
  const before = element.value;
  setNativeValue(element, value);
  if (element.value !== value || !element.validity.valid) { setNativeValue(element, before); return false; }
  dispatchChanged(element);
  if (!element.isConnected || element.value !== value || !element.validity.valid) {
    if (element.isConnected) { setNativeValue(element, before); dispatchChanged(element); }
    return false;
  }
  rollback.push({ fieldId: field.id, element, value: before, afterValue: value });
  return true;
}
export function rollbackFilled(entries: RollbackEntry[]): number {
  let changed = 0;
  for (const entry of [...entries].reverse()) {
    if (!editable(entry.element) || entry.element.value !== entry.afterValue) continue;
    setNativeValue(entry.element, entry.value); dispatchChanged(entry.element); changed++;
  }
  entries.length = 0; return changed;
}
function setNativeValue(element: Control, value: string): void {
  const view = element.ownerDocument.defaultView!;
  const prototype = isInput(element) ? view.HTMLInputElement.prototype : isSelect(element) ? view.HTMLSelectElement.prototype : view.HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
}
function dispatchChanged(element: Control): void {
  const EventClass = element.ownerDocument.defaultView!.Event;
  element.dispatchEvent(new EventClass("input", { bubbles: true, composed: true }));
  element.dispatchEvent(new EventClass("change", { bubbles: true, composed: true }));
}
