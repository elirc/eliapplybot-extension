/**
 * DOM helpers for the non-native widgets modern ATS forms use instead of
 * `<select>` and `<input type="radio">`.
 *
 * Everything here is deliberately read-only except the small set of explicitly
 * named interaction helpers, and every interaction helper refuses to touch a
 * control that could submit the application.
 */

/** Text that marks a control as "this advances or submits the application". */
const SUBMIT_TEXT_PATTERN = /\b(submit|apply now|apply|continue|next|previous|back|send application|finish|save and continue)\b/i;

/** Roles that identify a control as a toggle/answer rather than a form action. */
const TOGGLE_ROLES = new Set(["option", "radio", "checkbox", "switch", "menuitemradio", "menuitemcheckbox"]);

/** Selectors that identify a combobox-ish control we know how to drive. */
export const COMBOBOX_SELECTOR = "[role='combobox'], input[aria-autocomplete='list'], input[aria-autocomplete='both']";

/** Wrappers ATS forms group a single question into. */
export const FIELD_WRAPPER_SELECTOR =
  "[data-field-path], .ashby-application-form-field-entry, fieldset, [role='group'], [role='radiogroup']";

const COMBOBOX_CONTAINER_SELECTOR =
  "[class*='control'], [class*='value-container'], [class*='valueContainer'], [class*='combobox'], [data-field-path], .ashby-application-form-field-entry";

const DISPLAY_VALUE_SELECTOR =
  "[class*='single-value'], [class*='singleValue'], [class*='multi-value__label'], [class*='multiValue'], [class*='selected-value'], [class*='selectedValue']";

export type WidgetTiming = {
  /** How long to wait for a menu to open after we ask it to. */
  openBudgetMs: number;
  /** How long to wait for options to arrive in an opened (possibly async) menu. */
  optionsBudgetMs: number;
  /** How long to wait for the control to display the value we picked. */
  verifyBudgetMs: number;
  pollIntervalMs: number;
};

export const DEFAULT_TIMING: WidgetTiming = {
  openBudgetMs: 600,
  optionsBudgetMs: 800,
  verifyBudgetMs: 400,
  pollIntervalMs: 20
};

export function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Polls `read` until it returns something truthy or the budget runs out.
 * An empty result means "not yet", never "no", which is exactly the difference
 * between a menu that is still loading and a menu with no matching option.
 */
export async function waitFor<T>(read: () => T | null | undefined, budgetMs: number, intervalMs: number): Promise<T | null> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}

/**
 * True when clicking this element could plausibly submit or advance the
 * application. The filler clicks only listbox options and explicit answer
 * buttons, and this is the last line of defence in front of both.
 */
export function isUnsafeToClick(element: Element | null | undefined): boolean {
  if (!(element instanceof HTMLElement)) return true;

  const explicitType = (element.getAttribute("type") ?? "").toLowerCase();
  if (explicitType === "submit" || explicitType === "reset" || explicitType === "image") return true;

  const text = `${cleanText(element.textContent)} ${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("value") ?? ""}`;
  if (SUBMIT_TEXT_PATTERN.test(text)) return true;

  const role = (element.getAttribute("role") ?? "").toLowerCase();
  const isToggle =
    TOGGLE_ROLES.has(role) ||
    element.hasAttribute("aria-pressed") ||
    element.hasAttribute("aria-checked") ||
    element.hasAttribute("data-option");

  // A link navigates away from the half-filled application. An <option> that is
  // also an anchor is not worth the risk.
  if (element instanceof HTMLAnchorElement && element.hasAttribute("href")) return true;

  // A <button> with no explicit type submits the form it is in — and on the React
  // SPAs these boards are built as, the submit control is often not inside a
  // <form> at all, so membership proves nothing. Only ARIA-declared toggles get
  // the benefit of the doubt.
  if (!isToggle && element instanceof HTMLButtonElement && explicitType !== "button") return true;

  return false;
}

/**
 * Dispatches the full pointer sequence a real click produces.
 *
 * `HTMLElement.click()` synthesizes only a `click` event, so widgets that open
 * or toggle on `mousedown` (react-select's control, most custom dropdowns) do
 * nothing at all when it is used — the silent "clicked, nothing happened" bug.
 */
/**
 * Sends a real-looking click sequence, refusing anything that could submit.
 *
 * The guard is repeated here on purpose. Callers check it too — they need the
 * answer to pick a fallback target — but "this extension never clicks submit" is
 * a promise the README makes to someone filling in a real application, and it
 * should not depend on six separate call sites all remembering. Returns false if
 * it refused, so a caller can tell "clicked" from "declined".
 */
export function dispatchPointerClick(element: HTMLElement): boolean {
  if (isUnsafeToClick(element)) return false;
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    element.dispatchEvent(createPointerish(type));
  }
  return true;
}

function createPointerish(type: string): Event {
  const init: MouseEventInit = { bubbles: true, cancelable: true, composed: true, button: 0, detail: 1 };
  const PointerCtor = (globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent;
  if (type.startsWith("pointer") && typeof PointerCtor === "function") {
    return new PointerCtor(type, init);
  }
  return new MouseEvent(type, init);
}

/** Dispatches a keydown/keyup pair React's onKeyDown handler will see. */
export function dispatchKey(element: HTMLElement, key: string): void {
  const init: KeyboardEventInit = { key, code: key, bubbles: true, cancelable: true, composed: true };
  element.dispatchEvent(new KeyboardEvent("keydown", init));
  element.dispatchEvent(new KeyboardEvent("keyup", init));
}

export function isComboboxControl(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element instanceof HTMLSelectElement) return false;
  if (element.getAttribute("aria-hidden") === "true") return false;
  return element.matches(COMBOBOX_SELECTOR);
}

/**
 * Nearest ancestor matching `selector`, but only within `maxDepth` levels.
 *
 * Unbounded `closest()` with a loose selector such as `[class*='container']`
 * happily matches a page-wide layout div, which then makes every query run
 * against the whole document.
 */
export function closestWithin(element: HTMLElement, selector: string, maxDepth: number): HTMLElement | null {
  let node: HTMLElement | null = element.parentElement;
  for (let depth = 0; node && depth < maxDepth; depth += 1) {
    if (node.matches(selector)) return node;
    node = node.parentElement;
  }
  return null;
}

/** The visual shell around a combobox input (react-select's `select__control`). */
export function getComboboxContainer(control: HTMLElement): HTMLElement | null {
  return closestWithin(control, COMBOBOX_CONTAINER_SELECTOR, 4) ?? control.parentElement;
}

/**
 * What the control currently shows the user.
 *
 * react-select keeps its input's `value` empty and renders the chosen option in
 * a sibling `single-value` div, so reading `input.value` alone reports every
 * filled dropdown as blank.
 */
export function getComboboxDisplayValue(control: HTMLElement): string {
  const container = getComboboxContainer(control);
  if (container) {
    const nodes = Array.from(container.querySelectorAll(DISPLAY_VALUE_SELECTOR)).filter(
      (node) => node.querySelector(DISPLAY_VALUE_SELECTOR) === null
    );
    const text = nodes.map((node) => cleanText(node.textContent)).filter(Boolean).join(", ");
    if (text) return text;
  }

  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) return cleanText(control.value);
  return "";
}

export function isComboboxOpen(control: HTMLElement): boolean {
  return control.getAttribute("aria-expanded") === "true" || getComboboxContainer(control)?.getAttribute("aria-expanded") === "true";
}

/**
 * Finds the listbox belonging to `control`, searching from `document`.
 * Menus are commonly rendered in a portal at the end of <body>, so looking
 * inside the field's own subtree finds nothing.
 */
/** Every listbox currently rendered, used to tell "our menu" from someone else's. */
export function findOpenListboxes(): HTMLElement[] {
  return Array.from(document.querySelectorAll("[role='listbox']")).filter(
    (node): node is HTMLElement => node instanceof HTMLElement && isRenderedListbox(node)
  );
}

export function findListbox(control: HTMLElement, ignore?: ReadonlySet<Element>): HTMLElement | null {
  const referenced = [control.getAttribute("aria-controls"), control.getAttribute("aria-owns")]
    .filter((value): value is string => !!value)
    .flatMap((value) => value.split(/\s+/))
    .filter(Boolean);

  for (const id of referenced) {
    const node = document.getElementById(id);
    if (node instanceof HTMLElement && isRenderedListbox(node)) return node;
  }

  const id = control.getAttribute("id");
  if (id) {
    // react-select's own convention when it is not wired up with aria-controls.
    const byConvention = document.getElementById(`react-select-${id}-listbox`);
    if (byConvention instanceof HTMLElement && isRenderedListbox(byConvention)) return byConvention;
  }

  const container = getComboboxContainer(control);
  const local = container?.querySelector("[role='listbox']");
  if (local instanceof HTMLElement && isRenderedListbox(local)) return local;

  // Last resort: a single open menu anywhere on the page, but only one that
  // opened in response to us. A menu that was already open belongs to a different
  // question, and adopting it means clicking an answer into someone else's field.
  const open = findOpenListboxes().filter(
    (node) => !ignore?.has(node) && readOptionElements(node).length > 0
  );
  return open.length === 1 ? open[0] : null;
}

function isRenderedListbox(node: HTMLElement): boolean {
  if (node.hidden) return false;
  if (node.getAttribute("aria-hidden") === "true") return false;
  const style = node.ownerDocument.defaultView?.getComputedStyle(node);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  return true;
}

export function readOptionElements(listbox: HTMLElement): HTMLElement[] {
  return Array.from(listbox.querySelectorAll("[role='option']")).filter(
    (node): node is HTMLElement => node instanceof HTMLElement && node.getAttribute("aria-disabled") !== "true"
  );
}

export function readOptionText(option: HTMLElement): string {
  return cleanText(option.getAttribute("aria-label") || option.textContent);
}

/**
 * Options that can be read without touching the page.
 *
 * Detect must stay side-effect-free, so this never opens a menu. It reports
 * options only when the page already exposes them: an open menu, a `<datalist>`,
 * an `aria-controls` listbox that is rendered but collapsed, or the shadow
 * `<select>` some combobox libraries keep in sync for form submission.
 */
export function readAvailableOptions(control: HTMLElement): string[] | undefined {
  const listbox = findListbox(control);
  if (listbox) {
    const options = readOptionElements(listbox).map(readOptionText).filter(Boolean);
    if (options.length > 0) return options;
  }

  if (control instanceof HTMLInputElement) {
    const listId = control.getAttribute("list");
    const datalist = listId ? document.getElementById(listId) : null;
    if (datalist instanceof HTMLDataListElement) {
      const options = Array.from(datalist.options)
        .map((option) => cleanText(option.label || option.value))
        .filter(Boolean);
      if (options.length > 0) return options;
    }
  }

  const container = getComboboxContainer(control)?.parentElement ?? control.parentElement;
  const shadow = container?.querySelector("select");
  if (shadow instanceof HTMLSelectElement) {
    const options = Array.from(shadow.options).map((option) => cleanText(option.text)).filter(Boolean);
    if (options.length > 0) return options;
  }

  return undefined;
}

/**
 * The question wording for a control whose own labelling is missing or broken.
 *
 * Ashby renders `<label for="_systemfield_location">` next to a combobox input
 * that has no id at all, so `label[for]` resolution returns nothing and the
 * field would be reported unlabelled. The wrapper carrying `data-field-path`
 * still holds the question title.
 */
export function getWrapperLabel(element: HTMLElement): string {
  const wrapper = element.closest(FIELD_WRAPPER_SELECTOR);
  if (!(wrapper instanceof HTMLElement)) return "";

  const heading = wrapper.querySelector("label, legend, [role='heading'], h1, h2, h3, h4, h5, h6, [class*='label'], [class*='title']");
  if (heading instanceof HTMLElement && !heading.contains(element)) {
    const text = cleanText(heading.textContent).replace(/\s*\*\s*$/, "");
    if (text) return text;
  }

  // No heading element: fall back to the wrapper's own leading text, minus any
  // text contributed by the controls themselves.
  const controlText = Array.from(wrapper.querySelectorAll("button, [role='option'], [role='radio']"))
    .map((node) => cleanText(node.textContent))
    .filter(Boolean);
  let text = cleanText(wrapper.textContent);
  for (const part of controlText) text = text.split(part).join(" ");
  return cleanText(text).replace(/\s*\*\s*$/, "").slice(0, 200);
}

export type ButtonChoiceGroup = {
  container: HTMLElement;
  buttons: HTMLElement[];
};

/**
 * Yes/No button pairs and button-based radio groups.
 *
 * Ashby answers yes/no questions with two `<button data-option>` elements and a
 * `tabindex="-1"` checkbox that React never reads back; setting `.checked` on
 * that checkbox updates the DOM and submits nothing. The buttons are the field.
 */
export function findButtonChoiceGroups(root: ParentNode = document): ButtonChoiceGroup[] {
  const groups: ButtonChoiceGroup[] = [];
  const seen = new Set<HTMLElement>();

  const containers = Array.from(
    root.querySelectorAll(
      ".ashby-application-form-input-yesno, [role='radiogroup'], [class*='yesno'], [class*='yes-no'], [class*='button-group'], [class*='buttonGroup']"
    )
  );

  for (const container of containers) {
    if (!(container instanceof HTMLElement)) continue;
    if (seen.has(container)) continue;

    const buttons = Array.from(container.querySelectorAll("button, [role='radio'], [role='button']")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && isChoiceButton(node)
    );

    // One button is a toggle, not a choice; three or more is still a choice set.
    if (buttons.length < 2) continue;
    if (buttons.some(isUnsafeToClick)) continue;

    seen.add(container);
    groups.push({ container, buttons });
  }

  return groups;
}

function isChoiceButton(node: HTMLElement): boolean {
  if (node instanceof HTMLInputElement) return false;
  const role = (node.getAttribute("role") ?? "").toLowerCase();
  const marked =
    node.hasAttribute("data-option") || node.hasAttribute("aria-pressed") || node.hasAttribute("aria-checked") || role === "radio";
  if (!marked) return false;
  return cleanText(node.textContent).length > 0 || node.hasAttribute("data-option");
}

export function getChoiceButtonText(button: HTMLElement): string {
  return cleanText(button.getAttribute("aria-label") || button.textContent || button.getAttribute("data-option"));
}

export function isChoiceButtonPressed(button: HTMLElement): boolean {
  return button.getAttribute("aria-pressed") === "true" || button.getAttribute("aria-checked") === "true";
}
