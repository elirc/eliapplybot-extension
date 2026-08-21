import type { DetectedField, FieldMapping } from "../shared/types";
import { normalizeText } from "../shared/fieldMatchers";
import { clearCombobox, restoreComboboxValue, selectComboboxValue } from "./combobox";
import { findFieldElements, findFieldNodes } from "./scanner";
import {
  DEFAULT_TIMING,
  dispatchPointerClick,
  getChoiceButtonText,
  getComboboxDisplayValue,
  isChoiceButtonPressed,
  isUnsafeToClick,
  waitFor
} from "./widgets";

export type RollbackEntry = {
  fieldId: string;
  element: HTMLElement;
  /** The value (or displayed text) the control held before we touched it. */
  value: string;
  checked?: boolean;
  /** Set for controls that are not native form elements. */
  widget?: "combobox" | "buttons";
  /** For button groups: the answer button that was selected before, if any. */
  previous?: HTMLElement | null;
};

type RestoreResult = "restored" | "unchanged" | "failed";

/**
 * Fills one detected field.
 *
 * Async because ARIA comboboxes have to be opened and their options waited for;
 * every native control still resolves in the same tick without awaiting anything.
 */
export async function fillField(mapping: FieldMapping, field: DetectedField, rollback: RollbackEntry[]): Promise<boolean> {
  if (!mapping.value && mapping.value !== "") return false;

  if (field.elementType === "combobox") {
    const control = findFieldNodes(mapping.fieldId)[0];
    return control ? fillCombobox(mapping.fieldId, control, mapping.value, rollback) : false;
  }

  if (field.elementType === "buttongroup") {
    return fillButtonGroup(mapping.fieldId, findFieldNodes(mapping.fieldId), mapping.value, rollback);
  }

  const elements = findFieldElements(mapping.fieldId);
  if (elements.length === 0) return false;

  if (field.elementType === "radio" || field.elementType === "checkbox") {
    return fillChoiceGroup(elements.filter((element): element is HTMLInputElement => element instanceof HTMLInputElement), mapping.value, rollback);
  }

  const element = elements[0];
  if (element instanceof HTMLInputElement && ["file", "submit", "button", "reset", "image"].includes(element.type)) {
    return false;
  }

  if (element instanceof HTMLSelectElement) {
    const entry = snapshot(mapping.fieldId, element);
    const matched = selectOption(element, mapping.value);
    if (matched) {
      rollback.push(entry);
      dispatchChanged(element);
    }
    return matched;
  }

  rollback.push(snapshot(mapping.fieldId, element));
  setNativeValue(element, mapping.value);
  dispatchChanged(element);
  dispatchBlurred(element);
  return true;
}

/**
 * Restores what can be restored without waiting on a widget round-trip.
 *
 * Used by the sidebar's Clear button, whose handler is synchronous. Entries that
 * need an async restore (re-picking a value from a combobox menu) are counted as
 * *not* cleared and left in the list so a later clear can still fix them —
 * reporting a field as cleared while it still holds a value we put there is
 * worse than reporting a smaller number.
 */
export function rollbackFilled(entries: RollbackEntry[]): number {
  return applyRollback(entries, restoreSync);
}

/** Full restore, including re-selecting a combobox's previous option. */
export async function rollbackFilledAsync(entries: RollbackEntry[]): Promise<number> {
  const pending = entries.slice().reverse();
  const unresolved: RollbackEntry[] = [];
  let changed = 0;

  for (const entry of pending) {
    if (!document.contains(entry.element)) continue;
    const result = entry.widget === "combobox" ? await restoreComboboxEntry(entry) : restoreSync(entry);
    if (result === "failed") unresolved.push(entry);
    else if (result === "restored") changed += 1;
  }

  keepUnresolved(entries, unresolved);
  return changed;
}

function applyRollback(entries: RollbackEntry[], restore: (entry: RollbackEntry) => RestoreResult): number {
  const pending = entries.slice().reverse();
  const unresolved: RollbackEntry[] = [];
  let changed = 0;

  for (const entry of pending) {
    if (!document.contains(entry.element)) continue;
    const result = restore(entry);
    if (result === "failed") unresolved.push(entry);
    else if (result === "restored") changed += 1;
  }

  keepUnresolved(entries, unresolved);
  return changed;
}

function keepUnresolved(entries: RollbackEntry[], unresolved: RollbackEntry[]): void {
  entries.length = 0;
  for (const entry of unresolved.reverse()) entries.push(entry);
}

function restoreSync(entry: RollbackEntry): RestoreResult {
  const element = entry.element;

  if (entry.widget === "combobox") {
    if (!getComboboxDisplayValue(element) && !entry.value) return "unchanged";
    // Only the clear-back-to-empty case is possible without opening the menu.
    if (entry.value) return "failed";
    return clearCombobox(element) ? "restored" : "failed";
  }

  if (entry.widget === "buttons") return restoreButtonGroup(entry);

  if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
    const target = !!entry.checked;
    if (element.checked === target) return "unchanged";
    // Clicking is the only restore React sees, and it can switch a control on
    // or toggle a checkbox off. A radio cannot be un-checked by clicking, so
    // that one case falls back to the property.
    if (!target && element.type === "radio") {
      setNativeChecked(element, false);
      dispatchChanged(element);
    } else {
      element.click();
      if (element.checked !== target) {
        setNativeChecked(element, target);
        dispatchChanged(element);
      }
    }
    return "restored";
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    setNativeValue(element, entry.value);
    dispatchChanged(element);
    return "restored";
  }

  return "failed";
}

async function restoreComboboxEntry(entry: RollbackEntry): Promise<RestoreResult> {
  const current = getComboboxDisplayValue(entry.element);
  if (normalizeText(current) === normalizeText(entry.value)) return "unchanged";
  return (await restoreComboboxValue(entry.element, entry.value)) ? "restored" : "failed";
}

function restoreButtonGroup(entry: RollbackEntry): RestoreResult {
  const previous = entry.previous ?? null;

  if (previous) {
    if (isChoiceButtonPressed(previous)) return "unchanged";
    if (isUnsafeToClick(previous)) return "failed";
    dispatchPointerClick(previous);
    return isChoiceButtonPressed(previous) ? "restored" : "failed";
  }

  // Nothing was selected before. Re-clicking the answer we chose deselects it in
  // widgets that support it; in the ones that do not the state is unchanged, and
  // we say so instead of claiming a clear that did not happen.
  const chosen = entry.element;
  if (!isChoiceButtonPressed(chosen)) return "unchanged";
  if (isUnsafeToClick(chosen)) return "failed";
  dispatchPointerClick(chosen);
  return isChoiceButtonPressed(chosen) ? "failed" : "restored";
}

/**
 * Picks a value from an ARIA combobox (react-select and friends).
 *
 * Nothing is recorded for rollback unless the widget actually adopted the value,
 * so a refused or unverified selection leaves the page and the rollback log
 * exactly as they were.
 */
async function fillCombobox(fieldId: string, control: HTMLElement, value: string, rollback: RollbackEntry[]): Promise<boolean> {
  const before = getComboboxDisplayValue(control);
  const outcome = await selectComboboxValue(control, value);
  if (!outcome.ok) return false;
  if (outcome.changed) rollback.push({ fieldId, element: control, value: before, widget: "combobox" });
  return true;
}

/**
 * Answers a button-based question (Ashby's yes/no pairs).
 *
 * The checkbox Ashby hides beside these buttons is not the field: setting its
 * `.checked` updates the DOM and submits nothing, because React never reads it
 * back. Only the button press registers, and only `aria-pressed` proves it did.
 */
async function fillButtonGroup(fieldId: string, nodes: HTMLElement[], value: string, rollback: RollbackEntry[]): Promise<boolean> {
  const buttons = nodes.filter((node) => !(node instanceof HTMLInputElement));
  if (buttons.length === 0) return false;

  const target = normalizeText(value);
  if (!target) return false;

  // Exact match only: "Yes" must never resolve to "Yes, with sponsorship".
  const matches = buttons.filter(
    (button) => normalizeText(getChoiceButtonText(button)) === target || normalizeText(button.getAttribute("data-option") ?? "") === target
  );
  if (matches.length !== 1) return false;

  const button = matches[0];
  if (isUnsafeToClick(button)) return false;
  if (isChoiceButtonPressed(button)) return true;

  const previous = buttons.find(isChoiceButtonPressed) ?? null;
  dispatchPointerClick(button);

  const pressed = await waitFor(
    () => (isChoiceButtonPressed(button) ? true : null),
    DEFAULT_TIMING.verifyBudgetMs,
    DEFAULT_TIMING.pollIntervalMs
  );
  if (!pressed) return false;

  rollback.push({
    fieldId,
    element: button,
    value: previous ? getChoiceButtonText(previous) : "",
    widget: "buttons",
    previous
  });
  return true;
}

function fillChoiceGroup(inputs: HTMLInputElement[], value: string, rollback: RollbackEntry[]): boolean {
  const normalizedValue = normalizeText(value);
  const match = inputs.find((input) => {
    const label = normalizeText(getChoiceText(input));
    return label === normalizedValue || input.value.toLowerCase() === normalizedValue;
  });

  if (!match) return false;

  for (const input of inputs) rollback.push(snapshot(input.getAttribute("data-eli-apply-mate-field-id") ?? "", input));
  return activateChoice(match);
}

/**
 * Checks a radio or checkbox in a way React actually notices.
 *
 * React's change plugin listens for `click` on checkboxes and radios — not the
 * `input`/`change` pair it uses for text fields and selects — and its value
 * tracker follows `checked`, not `value`. Assigning `checked` and dispatching
 * input/change therefore updates the DOM while React's state stays empty: the
 * option looks chosen but submits blank. The element's own activation behavior
 * sets `checked` and fires click/input/change together, so prefer it.
 */
function activateChoice(input: HTMLInputElement): boolean {
  if (!input.checked) input.click();
  if (input.checked) return true;

  // Something called preventDefault on the click (overlay labels do this).
  // Fall back to the property, then announce it without re-dispatching a click,
  // which would toggle a checkbox straight back off.
  setNativeChecked(input, true);
  dispatchChanged(input);
  return input.checked;
}

function selectOption(select: HTMLSelectElement, value: string): boolean {
  const normalizedValue = normalizeText(value);
  const option = Array.from(select.options).find((candidate) => {
    const text = normalizeText(candidate.text);
    const candidateValue = normalizeText(candidate.value);
    return text === normalizedValue || candidateValue === normalizedValue;
  });

  if (!option) return false;
  setNativeValue(select, option.value);
  return true;
}

function snapshot(fieldId: string, element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): RollbackEntry {
  return {
    fieldId,
    element,
    value: element.value,
    checked: element instanceof HTMLInputElement ? element.checked : undefined
  };
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  // React >=16 overrides the value property on controlled inputs; calling the
  // prototype setter directly makes the dispatched input event register there too.
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
}

function dispatchBlurred(element: HTMLElement): void {
  // Form libraries that validate on blur (Formik, react-hook-form in onBlur
  // mode) leave a freshly filled field flagged invalid until it loses focus.
  // React registers the bubbling focusout, not the non-bubbling blur.
  element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

function setNativeChecked(element: HTMLInputElement, checked: boolean): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
  if (setter) {
    setter.call(element, checked);
  } else {
    element.checked = checked;
  }
}

function dispatchChanged(element: HTMLElement): void {
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function getChoiceText(input: HTMLInputElement): string {
  const id = input.id;
  const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
  if (explicit instanceof HTMLElement) return explicit.innerText;
  const parentLabel = input.closest("label");
  if (parentLabel instanceof HTMLElement) return parentLabel.innerText;
  return input.value;
}
