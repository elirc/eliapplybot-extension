import type { DetectedField, FieldMapping, FillResult } from "../shared/types";
import { findFieldElements } from "../content/scanner";
import css from "./sidebar.css";

let host: HTMLDivElement | null = null;
let returnFocus: HTMLElement | null = null;
function close(): void {
  host?.remove(); host = null;
  document.removeEventListener("keydown", closeOnEscape);
  if (returnFocus?.isConnected) returnFocus.focus();
}
function closeOnEscape(event: KeyboardEvent): void { if (event.key === "Escape") close(); }
export function debugFields(fields: DetectedField[]): unknown[] {
  return fields.map(({ id, elementType, inputType, required, disabled, readOnly, options }) => ({
    id, elementType, inputType, required: !!required, disabled: !!disabled, readOnly: !!readOnly, optionCount: options?.length ?? 0
  }));
}
export function renderSidebar(result: FillResult, onClear: () => Promise<number>): void {
  if (!host?.isConnected) returnFocus = document.activeElement as HTMLElement | null;
  host?.remove();
  host = document.createElement("div"); host.id = "eli-apply-mate-sidebar";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style"); style.textContent = css; shadow.append(style);
  const panel = document.createElement("aside"); panel.className = "eam-panel"; panel.setAttribute("aria-label", "Autofill review"); panel.tabIndex = -1;
  const header = document.createElement("header"); header.className = "eam-header";
  const title = document.createElement("h2"); title.className = "eam-title"; title.textContent = "eli apply mate review";
  const closeButton = button("Close review", close); closeButton.title = "Close review (Escape)";
  const status = document.createElement("p"); status.setAttribute("role", "status");
  status.textContent = result.mode === "cleared" ? "Last fill undone. Later manual edits were preserved." : result.mode === "detect" ? "Detection only. No values changed." : "Autofill finished. Check the answers in the form.";
  const counts = document.createElement("div"); counts.className = "eam-counts";
  for (const [name, count] of [["Filled", result.filled.length], ["Review", result.unsure.length], ["Skipped", result.skipped.length], ["Missing required", result.missingRequired.length]]) {
    const item = document.createElement("div"); item.className = "eam-count"; item.textContent = `${count} ${name}`; counts.append(item);
  }
  const clearButton = button("Undo last fill", async () => {
    clearButton.disabled = true;
    try { await onClear(); } catch (error) { status.textContent = String(error); clearButton.disabled = false; }
  }); clearButton.dataset.action = "clear";
  const copy = button("Copy structural debug JSON", async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(debugFields(result.detected), null, 2)); status.textContent = "Copied structural details without labels or personal values."; }
    catch { status.textContent = "Clipboard access was denied. No data was copied."; }
  }); copy.dataset.action = "copy";
  header.append(title, closeButton, status, counts, clearButton, copy);
  const scope = document.createElement("p"); scope.textContent = "Only visible supported fields were checked. Required counts describe empty fields, not full form validity."; header.append(scope);
  for (const warning of result.warnings ?? []) { const p = document.createElement("p"); p.textContent = warning; header.append(p); }
  panel.append(header, section("Filled", result.filled), section("Needs review", result.unsure), section("Skipped", result.skipped),
    section("Missing required", result.missingRequired.map((f) => ({ fieldId: f.id, labelText: f.labelText, kind: "unknown", confidence: "low", reason: "Complete this field in the form." }))));
  shadow.append(panel); document.documentElement.append(host);
  document.addEventListener("keydown", closeOnEscape);
  panel.focus();
}
function button(text: string, action: () => unknown): HTMLButtonElement {
  const node = document.createElement("button"); node.type = "button"; node.className = "eam-button"; node.textContent = text; node.addEventListener("click", () => { void action(); }); return node;
}
function section(title: string, mappings: FieldMapping[]): HTMLElement {
  const node = document.createElement("section"); node.className = "eam-section";
  const heading = document.createElement("h3"); heading.textContent = title; node.append(heading);
  if (!mappings.length) { const p = document.createElement("p"); p.textContent = "None."; node.append(p); }
  for (const mapping of mappings) {
    const item = document.createElement("div"); item.className = "eam-item";
    item.append(button(mapping.labelText || "Unlabeled field", () => {
      const control = findFieldElements(mapping.fieldId)[0];
      if (control) { control.scrollIntoView({ block: "center", behavior: "smooth" }); control.focus(); }
    }));
    const reason = document.createElement("p"); reason.className = "eam-meta"; reason.textContent = mapping.reason; item.append(reason); node.append(item);
  }
  return node;
}
