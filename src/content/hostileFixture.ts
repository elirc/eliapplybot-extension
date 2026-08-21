import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCRIPT_PATTERN = /<script>([\s\S]*?)<\/script>/g;

/**
 * Loads `test-pages/hostile-application.html` into the current jsdom document,
 * behaviour included.
 *
 * jsdom does not execute `<script>` elements inserted through `innerHTML`, and
 * this page is only hostile because of its scripts: menus that open on
 * `mousedown` and never on `click`, options that arrive late, a virtualized
 * list, buttons that answer a question React style. Running the page's own
 * script keeps the fixture the single source of truth for that behaviour rather
 * than re-implementing it (differently, and more forgivingly) in the tests.
 */
export function loadHostilePage(): void {
  const html = readFileSync(resolve(__dirname, "../../test-pages/hostile-application.html"), "utf8");
  const body = html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? html;

  document.body.innerHTML = body.replace(SCRIPT_PATTERN, "");
  for (const [, code] of html.matchAll(SCRIPT_PATTERN)) {
    new Function(code)();
  }
}

/** The combobox input for one `data-select-field` section of the hostile page. */
export function hostileCombobox(field: string): HTMLInputElement {
  const control = document.querySelector<HTMLInputElement>(`[data-select-field="${field}"] .select__input`);
  if (!control) throw new Error(`Missing combobox ${field}`);
  return control;
}

/** What the widget currently shows for one `data-select-field` section. */
export function hostileComboboxDisplay(field: string): string {
  const display = document.querySelector(`[data-select-field="${field}"] .select__single-value`);
  return display?.textContent?.trim() ?? "";
}

export function openMenus(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[role='listbox']"));
}
