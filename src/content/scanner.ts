import type { DetectedField, SiteAdapter } from "../shared/types";
import { getBestLabel, getChoiceQuestion, getControlValue, getNearbyText, getOptionLabel, getSectionText, isControl, isInput, isSelect, type Control } from "./domLabels";

const identities = new WeakMap<object, number>();
let nextId = 1;
let controlsById = new Map<string, Control[]>();
let warnings: string[] = [];
function identity(value: object): number {
  if (!identities.has(value)) identities.set(value, nextId++);
  return identities.get(value)!;
}
export function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  let current: HTMLElement | null = element;
  while (current) {
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (current.hidden || current.hasAttribute("inert") || style?.display === "none" || style?.visibility === "hidden" || style?.visibility === "collapse") return false;
    current = current.parentElement ?? ((current.getRootNode() as ShadowRoot).host as HTMLElement | undefined) ?? null;
  }
  const frame = element.ownerDocument.defaultView?.frameElement;
  if (frame && !isVisible(frame as HTMLElement)) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
export function scanPage(adapter?: SiteAdapter): DetectedField[] {
  const controls: Control[] = [];
  warnings = [];
  const walk = (root: Document | ShadowRoot) => {
    for (const element of root.querySelectorAll("*")) {
      if (element.id === "eli-apply-mate-sidebar") continue;
      if (isControl(element) && isVisible(element)) controls.push(element);
      if (element.shadowRoot && element.id !== "eli-apply-mate-sidebar") walk(element.shadowRoot);
      if (element.tagName === "IFRAME") {
        try {
          const doc = (element as HTMLIFrameElement).contentDocument;
          if (doc) walk(doc); else warnings.push("An embedded form cannot be inspected. Review its fields manually.");
        } catch { warnings.push("An embedded form cannot be inspected. Review its fields manually."); }
      }
      if (element.matches("[role='combobox'],[role='listbox'],[contenteditable='true']") && !isSelect(element)) warnings.push("Custom form widgets need manual review.");
    }
  };
  walk(document);
  controlsById = new Map();
  const groups = new Map<string, HTMLInputElement[]>();
  const singles: Control[] = [];
  for (const control of controls) {
    if (isInput(control) && control.type === "hidden") continue;
    if (isInput(control) && control.type === "radio" && control.name) {
      const scope = control.form ?? control.getRootNode();
      const key = `${identity(scope)}:${control.name}`;
      const group = groups.get(key) ?? []; group.push(control); groups.set(key, group);
    } else singles.push(control);
  }
  const fields: DetectedField[] = [];
  for (const elements of [...groups.values(), ...singles.map((c) => [c])]) {
    const first = elements[0];
    const choice = isInput(first) && ["radio", "checkbox"].includes(first.type);
    const id = `eam-field-${identity(first)}`;
    controlsById.set(id, elements);
    const field: DetectedField = {
      id, elementType: choice ? first.type as "radio" | "checkbox" : isSelect(first) ? "select" : first.tagName === "TEXTAREA" ? "textarea" : "input",
      inputType: isInput(first) ? first.type : undefined,
      labelText: choice && first.type === "radio" ? getChoiceQuestion(first) || getBestLabel(first) : getBestLabel(first),
      nearbyText: getNearbyText(first), sectionText: getSectionText(first),
      name: first.name || undefined, idAttribute: first.id || undefined,
      placeholder: first.getAttribute("placeholder") ?? undefined,
      autocomplete: first.getAttribute("autocomplete") ?? undefined,
      disabled: elements.every((e) => e.matches(":disabled")),
      readOnly: first.hasAttribute("readonly") || first.getAttribute("role") === "combobox" || first.getAttribute("aria-readonly") === "true",
      options: choice ? elements.map((e) => getOptionLabel(e as HTMLInputElement)) : isSelect(first) ? Array.from(first.options).filter((o) => !o.disabled).map((o) => o.text) : undefined,
      required: elements.some((e) => e.required || e.getAttribute("aria-required") === "true"),
      valueBefore: choice ? elements.filter((e) => (e as HTMLInputElement).checked).map((e) => getOptionLabel(e as HTMLInputElement)).join(", ") : getControlValue(first)
    };
    fields.push(adapter?.normalizeField ? adapter.normalizeField(field) : field);
  }
  return fields;
}
export function findFieldElements(id: string): Control[] { return (controlsById.get(id) ?? []).filter((e) => isVisible(e)); }
export function getScanWarnings(): string[] { return [...new Set(warnings)]; }
