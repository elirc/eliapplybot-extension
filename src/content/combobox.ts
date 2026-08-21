import { normalizeText } from "../shared/fieldMatchers";
import {
  DEFAULT_TIMING,
  cleanText,
  closestWithin,
  dispatchKey,
  dispatchPointerClick,
  findListbox,
  findOpenListboxes,
  getComboboxContainer,
  getComboboxDisplayValue,
  isComboboxOpen,
  isUnsafeToClick,
  readOptionElements,
  readOptionText,
  waitFor,
  type WidgetTiming
} from "./widgets";

export type ComboboxFailure =
  | "empty-value"
  | "menu-did-not-open"
  | "no-options"
  | "no-exact-match"
  | "ambiguous-options"
  | "unsafe-option"
  | "not-verified";

export type ComboboxOutcome =
  | { ok: true; value: string; changed: boolean }
  | { ok: false; reason: ComboboxFailure };

const CLEAR_SELECTOR =
  "[class*='clear-indicator'], [class*='clearIndicator'], [class*='clear-button'], [aria-label*='clear' i], [title*='clear' i]";

/**
 * Picks `value` from a combobox, or leaves the field exactly as it found it.
 *
 * The contract is deliberately unforgiving: only an option whose text is
 * *equal* to the target after normalization is ever clicked. A work
 * authorization question offering "Yes" and "Yes, with sponsorship" must never
 * resolve "Yes" to the second one, and no fuzzy or first-option fallback exists
 * anywhere in this function. Anything short of one exact match closes the menu
 * and reports failure, which surfaces to the user as "unsure".
 */
export async function selectComboboxValue(
  control: HTMLElement,
  value: string,
  timing: WidgetTiming = DEFAULT_TIMING
): Promise<ComboboxOutcome> {
  const target = normalizeText(value);
  if (!target) return { ok: false, reason: "empty-value" };

  if (normalizeText(getComboboxDisplayValue(control)) === target) {
    return { ok: true, value: cleanText(getComboboxDisplayValue(control)), changed: false };
  }

  // Autocompletes that hold their own text (Lever's location field) may already
  // contain something the user typed. Typing a filter overwrites it, so remember
  // it: a refusal has to put it back, not leave the field empty.
  const originalInput = control instanceof HTMLInputElement ? control.value : "";

  let typed = false;
  const listbox = await openMenu(control, timing);
  if (!listbox) {
    closeMenu(control, false);
    return { ok: false, reason: "menu-did-not-open" };
  }

  // An empty menu means "still loading", not "no match" — several boards fetch
  // location and school options only once the menu is opened or typed into.
  let options = await waitForOptions(listbox, timing);
  if (options.length === 0 && canType(control)) {
    typeFilter(control, value);
    typed = true;
    options = await waitForOptions(listbox, timing);
  }
  if (options.length === 0) {
    finish(control, typed ? originalInput : null, false);
    return { ok: false, reason: "no-options" };
  }

  let matches = exactMatches(options, target);

  // Long option lists are virtualized: what is in the DOM is only what is on
  // screen, so a missing match may just be a match that has not rendered.
  // Typing narrows the list server-side or client-side, then we look again.
  if (matches.length === 0 && !typed && canType(control)) {
    typeFilter(control, value);
    typed = true;
    const filtered = await waitFor(
      () => {
        const current = readOptions(listbox);
        return exactMatches(current, target).length > 0 ? current : null;
      },
      timing.optionsBudgetMs,
      timing.pollIntervalMs
    );
    matches = exactMatches(filtered ?? readOptions(listbox), target);
  }

  if (matches.length === 0) {
    finish(control, typed ? originalInput : null, false);
    return { ok: false, reason: "no-exact-match" };
  }
  if (matches.length > 1) {
    finish(control, typed ? originalInput : null, false);
    return { ok: false, reason: "ambiguous-options" };
  }

  const option = matches[0];
  if (isUnsafeToClick(option)) {
    finish(control, typed ? originalInput : null, false);
    return { ok: false, reason: "unsafe-option" };
  }

  const optionText = readOptionText(option);
  dispatchPointerClick(option);

  const verified = await waitFor(
    () => (normalizeText(getComboboxDisplayValue(control)) === target ? true : null),
    timing.verifyBudgetMs,
    timing.pollIntervalMs
  );

  if (!verified) {
    // The click was accepted by the DOM but the widget never adopted the value.
    // Reporting success here is the failure mode that silently submits a blank
    // work-authorization answer, so report the truth instead.
    finish(control, typed ? originalInput : null, false);
    return { ok: false, reason: "not-verified" };
  }

  finish(control, null, true);
  return { ok: true, value: optionText, changed: true };
}

/**
 * Restores a combobox to a previously displayed value, or reports that it could
 * not. Returns false rather than pretending — a field left holding a value we
 * put there must not be reported as cleared.
 */
export async function restoreComboboxValue(
  control: HTMLElement,
  previous: string,
  timing: WidgetTiming = DEFAULT_TIMING
): Promise<boolean> {
  const current = getComboboxDisplayValue(control);
  if (normalizeText(current) === normalizeText(previous)) return true;
  if (!previous) return clearCombobox(control);

  const outcome = await selectComboboxValue(control, previous, timing);
  return outcome.ok;
}

/**
 * Synchronous best effort used by the sidebar's Clear button, which cannot wait
 * for a menu round-trip. Only clearing back to empty is possible without one.
 */
export function clearCombobox(control: HTMLElement): boolean {
  if (!getComboboxDisplayValue(control)) return true;

  const shell = closestWithin(control, "[class*='control']", 5) ?? getComboboxContainer(control);
  const clear = shell?.querySelector(CLEAR_SELECTOR);
  if (clear instanceof HTMLElement && !isUnsafeToClick(clear)) {
    dispatchPointerClick(clear);
    if (!getComboboxDisplayValue(control)) return true;
  }

  // A plain autocomplete input holds its own value; a react-select one does not,
  // so this only helps the former and is harmless for the latter.
  if (canType(control) && control.value) {
    setNativeInputValue(control, "");
    dispatchInputEvent(control);
    if (!getComboboxDisplayValue(control)) return true;
  }

  return false;
}

async function openMenu(control: HTMLElement, timing: WidgetTiming): Promise<HTMLElement | null> {
  // Anything already on screen belongs to another question; only a menu that
  // appears after we act may be adopted by the unattributed last-resort lookup.
  // Snapshotted before the aria-expanded check below, because a widget claiming
  // to be open while its own menu is undiscoverable is exactly the ambiguous
  // case — there, adopting a stranger's menu would answer a stranger's question.
  const foreign: ReadonlySet<Element> = new Set(findOpenListboxes());

  if (isComboboxOpen(control)) {
    const already = findListbox(control, foreign);
    if (already) return already;
  }

  focus(control);

  // The keyboard is the reliable opener for react-select: its control handles
  // mousedown (which .click() never produces) but its input handles keydown,
  // and React runs handlers for dispatched, untrusted events all the same.
  dispatchKey(control, "ArrowDown");

  const half = Math.max(timing.pollIntervalMs, Math.floor(timing.openBudgetMs / 2));
  const viaKeyboard = await waitFor(() => findListbox(control, foreign), half, timing.pollIntervalMs);
  if (viaKeyboard) return viaKeyboard;

  // Widgets that only listen for pointer events (Ashby, Workday) need the full
  // pointerdown → mousedown → mouseup → click sequence on the control shell.
  const shell = getComboboxContainer(control) ?? control;
  if (!isUnsafeToClick(shell)) dispatchPointerClick(shell);
  else if (!isUnsafeToClick(control)) dispatchPointerClick(control);

  return waitFor(() => findListbox(control, foreign), timing.openBudgetMs - half, timing.pollIntervalMs);
}

function waitForOptions(listbox: HTMLElement, timing: WidgetTiming): Promise<HTMLElement[]> {
  return waitFor(
    () => {
      const options = readOptions(listbox);
      return options.length > 0 ? options : null;
    },
    timing.optionsBudgetMs,
    timing.pollIntervalMs
  ).then((options) => options ?? []);
}

function readOptions(listbox: HTMLElement): HTMLElement[] {
  // The menu may have been re-rendered into a different node while we waited.
  return listbox.isConnected ? readOptionElements(listbox) : [];
}

function exactMatches(options: HTMLElement[], target: string): HTMLElement[] {
  return options.filter((option) => normalizeText(readOptionText(option)) === target);
}

function canType(control: HTMLElement): control is HTMLInputElement {
  return control instanceof HTMLInputElement && !control.readOnly && !control.disabled;
}

function typeFilter(control: HTMLInputElement, value: string): void {
  setNativeInputValue(control, value);
  dispatchInputEvent(control);
}

/**
 * Closes up after an attempt, putting back any text we typed as a filter.
 *
 * `restoreTo` is the value the input held before we touched it — usually empty,
 * but on an autocomplete the user may have typed something themselves. Clearing
 * to "" instead would mean a refusal silently deletes their text.
 */
function finish(control: HTMLElement, restoreTo: string | null, keepOpenState: boolean): void {
  // Close first. A react-select-style widget blanks its own input on close, so
  // restoring before that would just be undone; restoring afterwards is correct
  // for both those widgets (where the original was empty anyway) and for plain
  // autocompletes that keep whatever the user typed.
  closeMenu(control, keepOpenState);

  if (restoreTo !== null && canType(control) && control.value !== restoreTo) {
    setNativeInputValue(control, restoreTo);
    dispatchInputEvent(control);
  }
}

function closeMenu(control: HTMLElement, skipEscape: boolean): void {
  // Escape is only sent when a menu is genuinely still open: a few widgets treat
  // Escape on a closed combobox as "clear the value", which would undo a
  // selection we just made.
  if (!skipEscape && (isComboboxOpen(control) || findListbox(control))) dispatchKey(control, "Escape");
  control.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

function focus(control: HTMLElement): void {
  try {
    control.focus({ preventScroll: true });
  } catch {
    control.focus();
  }
  control.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
}

function setNativeInputValue(element: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
}

function dispatchInputEvent(element: HTMLElement): void {
  element.dispatchEvent(new Event("input", { bubbles: true }));
}
