import type { DetectedField, ElementType, SiteAdapter } from "../shared/types";
import { getBestLabel, getControlValue, getNearbyText, getOptionLabel, getSectionText } from "./domLabels";
import {
  COMBOBOX_SELECTOR,
  cleanText,
  findButtonChoiceGroups,
  getChoiceButtonText,
  getComboboxDisplayValue,
  getWrapperLabel,
  isChoiceButtonPressed,
  isComboboxControl,
  readAvailableOptions
} from "./widgets";

const FIELD_ID_ATTR = "data-eli-apply-mate-field-id";

const WIDGET_SHELL_SELECTOR =
  "[class*='control'], [class*='container'], .ashby-application-form-input-yesno, [data-field-path], .ashby-application-form-field-entry";

/**
 * Reads every fillable control on the page without touching any of them.
 *
 * Detect is expected to be side-effect-free: no menu is opened, nothing is
 * clicked, nothing is focused. Widgets whose options only exist while their menu
 * is open are therefore reported with `options: undefined`, and the filler
 * discovers the real options at fill time.
 */
export function scanPage(adapter?: SiteAdapter): DetectedField[] {
  // Ids restart at zero on every scan, so a stamp left over from a previous scan
  // can collide with a fresh one. If a field went hidden between Detect and
  // Autofill — routine on a re-rendering SPA — `eam-field-0` would then match two
  // nodes and the fill would land on the stale one while reporting success.
  for (const stale of Array.from(document.querySelectorAll(`[${FIELD_ID_ATTR}]`))) {
    stale.removeAttribute(FIELD_ID_ATTR);
  }

  const fields: DetectedField[] = [];
  const claimed = new Set<Element>();
  let index = 0;

  // 1. Button-based choice groups first: they own the inputs hidden inside them
  // (Ashby keeps a tabindex="-1" checkbox next to each yes/no pair) and those
  // inputs must not also be reported as a separate checkbox field.
  for (const group of findButtonChoiceGroups()) {
    const visibleButtons = group.buttons.filter(isVisible);
    if (visibleButtons.length < 2) continue;

    for (const node of group.container.querySelectorAll("input, textarea, select")) claimed.add(node);
    for (const button of group.buttons) claimed.add(button);

    const id = `eam-field-${index++}`;
    for (const button of visibleButtons) button.setAttribute(FIELD_ID_ATTR, id);

    const first = visibleButtons[0];
    fields.push(
      normalize(adapter, {
        id,
        elementType: "buttongroup",
        labelText: resolveLabel(first),
        nearbyText: getNearbyText(first),
        sectionText: getSectionText(first),
        name: group.container.querySelector("input[name]")?.getAttribute("name") ?? undefined,
        idAttribute: group.container.getAttribute("id") ?? group.container.getAttribute("data-field-path") ?? undefined,
        options: visibleButtons.map(getChoiceButtonText).filter(Boolean),
        required: isRequired(group.container),
        valueBefore: visibleButtons.filter(isChoiceButtonPressed).map(getChoiceButtonText).join(", ")
      })
    );
  }

  // 2. Native radio/checkbox groups.
  const groupedNames = new Set<string>();
  const groupInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[type='radio'], input[type='checkbox']")).filter(
    (input) => !claimed.has(input)
  );

  for (const input of groupInputs) {
    if (!isVisible(input)) continue;
    const groupKey = getGroupKey(input);
    if (groupedNames.has(groupKey)) continue;
    groupedNames.add(groupKey);

    const members = groupInputs.filter((candidate) => getGroupKey(candidate) === groupKey && isVisible(candidate));
    const id = `eam-field-${index++}`;
    for (const member of members) member.setAttribute(FIELD_ID_ATTR, id);

    const first = members[0];
    const field = normalize(adapter, {
      id,
      elementType: first.type === "radio" ? "radio" : "checkbox",
      inputType: first.type,
      labelText: getBestLabel(first),
      nearbyText: getNearbyText(first),
      sectionText: getSectionText(first),
      name: first.name || undefined,
      idAttribute: first.id || undefined,
      options: members.map(getOptionLabel).filter(Boolean),
      required: members.some((member) => member.required),
      valueBefore: members.filter((member) => member.checked).map(getOptionLabel).join(", ")
    });
    fields.push(field);
  }

  // 3. Comboboxes. Claimed before the native pass so a `<input role="combobox">`
  // is never reported twice, once as a widget and once as a text input.
  for (const control of Array.from(document.querySelectorAll<HTMLElement>(COMBOBOX_SELECTOR))) {
    if (claimed.has(control)) continue;
    if (!isComboboxControl(control) || !isVisible(control)) continue;
    claimed.add(control);

    const id = `eam-field-${index++}`;
    control.setAttribute(FIELD_ID_ATTR, id);

    fields.push(
      normalize(adapter, {
        id,
        elementType: "combobox",
        inputType: control instanceof HTMLInputElement ? control.type : undefined,
        labelText: resolveLabel(control),
        nearbyText: getNearbyText(control),
        sectionText: getSectionText(control),
        name: control.getAttribute("name") ?? undefined,
        idAttribute: control.getAttribute("id") ?? undefined,
        placeholder: control.getAttribute("placeholder") ?? getPlaceholderText(control),
        // Only what is already visible on the page; opening the menu to look
        // would make Detect change the page it is describing.
        options: readAvailableOptions(control),
        required: isRequired(control),
        valueBefore: getComboboxDisplayValue(control)
      })
    );
  }

  // 4. Native inputs, textareas and selects.
  const controls = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select"));
  for (const control of controls) {
    if (claimed.has(control)) continue;
    if (!isVisible(control)) continue;
    if (control instanceof HTMLInputElement && (control.type === "radio" || control.type === "checkbox")) continue;
    if (control instanceof HTMLInputElement && control.type === "hidden") continue;
    // react-select renders an `aria-hidden` shim input purely to trigger the
    // browser's own "please fill this in" bubble; it is not a real field.
    if (control.getAttribute("aria-hidden") === "true") continue;

    const id = `eam-field-${index++}`;
    control.setAttribute(FIELD_ID_ATTR, id);
    const elementType = getElementType(control);

    const field = normalize(adapter, {
      id,
      elementType,
      inputType: control instanceof HTMLInputElement ? control.type : undefined,
      labelText: getBestLabel(control) || getWrapperLabel(control),
      nearbyText: getNearbyText(control),
      sectionText: getSectionText(control),
      name: control.getAttribute("name") ?? undefined,
      idAttribute: control.getAttribute("id") ?? undefined,
      placeholder: control.getAttribute("placeholder") ?? undefined,
      options: control instanceof HTMLSelectElement ? Array.from(control.options).map((option) => option.text).filter(Boolean) : undefined,
      required: control.required || control.getAttribute("aria-required") === "true",
      valueBefore: getControlValue(control)
    });
    fields.push(field);
  }

  return fields;
}

/** Every tagged node for a field, including buttons and non-input widgets. */
export function findFieldNodes(fieldId: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(`[${FIELD_ID_ATTR}="${CSS.escape(fieldId)}"]`)).filter(
    (element): element is HTMLElement => element instanceof HTMLElement
  );
}

export function findFieldElements(fieldId: string): Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> {
  return findFieldNodes(fieldId).filter(
    (element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
  );
}

/**
 * Normal label resolution, then the wrapper fallback.
 *
 * Ashby points `<label for="_systemfield_location">` at an id that exists
 * nowhere in the document while the combobox input it belongs to has no id and
 * no name, so `label[for]` silently resolves to nothing and the field looks
 * unlabelled. The question title still lives on the `[data-field-path]` wrapper.
 */
function resolveLabel(control: HTMLElement): string {
  const direct = getBestLabel(control);
  if (direct) return direct;
  return getWrapperLabel(control);
}

function getPlaceholderText(control: HTMLElement): string | undefined {
  const container = control.parentElement;
  const placeholder = container?.querySelector("[class*='placeholder']");
  return placeholder instanceof HTMLElement ? cleanText(placeholder.textContent) || undefined : undefined;
}

function isRequired(element: HTMLElement): boolean {
  if (element.getAttribute("aria-required") === "true") return true;
  if (element instanceof HTMLInputElement && element.required) return true;
  // react-select and Ashby both park a hidden, required input inside the widget
  // so the browser still enforces the question. That shim is the only reliable
  // "required" signal on a widget with no native control of its own. The search
  // stops a few levels up so it can never wander into a neighbouring question.
  let node: HTMLElement | null = element;
  for (let depth = 0; node && depth <= 4; depth += 1) {
    if (node.matches(WIDGET_SHELL_SELECTOR) && node.querySelector("input[required], [aria-required='true']")) return true;
    node = node.parentElement;
  }
  return false;
}

function getElementType(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): ElementType {
  if (control instanceof HTMLTextAreaElement) return "textarea";
  if (control instanceof HTMLSelectElement) return "select";
  return "input";
}

function getGroupKey(input: HTMLInputElement): string {
  const fieldset = input.closest("fieldset");
  const fieldsetText = fieldset?.querySelector("legend")?.textContent?.trim() ?? "";
  // Unnamed inputs outside a fieldset would otherwise all collapse into one
  // page-wide group; scope them to their nearest structural container instead.
  const structuralKey = input.name || fieldset ? "" : getStructuralKey(input);
  return [input.type, input.name, fieldsetText, input.form?.id, structuralKey].join("|");
}

const structuralKeys = new WeakMap<Element, number>();
let nextStructuralKey = 1;

function getStructuralKey(input: HTMLInputElement): string {
  const container =
    input.closest("[role='radiogroup'], [role='group']") ??
    input.parentElement?.parentElement ??
    input.parentElement ??
    input;
  let key = structuralKeys.get(container);
  if (key === undefined) {
    key = nextStructuralKey++;
    structuralKeys.set(container, key);
  }
  return `container-${key}`;
}

function isVisible(element: HTMLElement): boolean {
  if (element.hidden) return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function normalize(adapter: SiteAdapter | undefined, field: DetectedField): DetectedField {
  return adapter?.normalizeField ? adapter.normalizeField(field) : field;
}
