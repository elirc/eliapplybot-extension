import type { DetectedField, FieldMapping, FillResult } from "../shared/types";
import css from "./sidebar.css";

let host: HTMLDivElement | null = null;

export function renderSidebar(result: FillResult, onClear: () => number): void {
  if (host) host.remove();
  host = document.createElement("div");
  host.id = "eli-apply-mate-sidebar";

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  shadow.append(style, buildPanel(result, onClear));
  document.documentElement.append(host);
  document.addEventListener("keydown", closeOnEscape);
}

function closeOnEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  host?.remove();
  host = null;
  document.removeEventListener("keydown", closeOnEscape);
}

function buildPanel(result: FillResult, onClear: () => number): HTMLElement {
  const panel = document.createElement("aside");
  panel.className = "eam-panel";

  const header = document.createElement("header");
  header.className = "eam-header";
  header.innerHTML = `
    <div class="eam-title-row">
      <div>
        <h2 class="eam-title">eli apply mate</h2>
        <div class="eam-site">${escapeHtml(result.site)} review · profile: ${escapeHtml(result.profileName)}</div>
      </div>
      <button class="eam-button eam-close" type="button" title="Close">x</button>
    </div>
    <div class="eam-counts">
      <div class="eam-count"><strong>${result.filled.length}</strong>Filled</div>
      <div class="eam-count"><strong>${result.unsure.length}</strong>Unsure</div>
      <div class="eam-count"><strong>${result.skipped.length}</strong>Skipped</div>
      <div class="eam-count"><strong>${result.missingRequired.length}</strong>Required</div>
    </div>
    <div class="eam-actions">
      <button class="eam-button" type="button" data-action="clear">Clear filled values</button>
      <button class="eam-button" type="button" data-action="copy">Copy debug JSON</button>
    </div>
  `;

  const closeButton = header.querySelector<HTMLButtonElement>(".eam-close");
  closeButton?.addEventListener("click", () => host?.remove());

  const clearButton = header.querySelector<HTMLButtonElement>("[data-action='clear']");
  clearButton?.addEventListener("click", () => {
    const count = onClear();
    clearButton.textContent = `Cleared ${count}`;
  });

  const copyButton = header.querySelector<HTMLButtonElement>("[data-action='copy']");
  copyButton?.addEventListener("click", async () => {
    // Never export what the user already typed on the page — mask valueBefore.
    const redacted = result.detected.map((field) => ({
      ...field,
      valueBefore: field.valueBefore ? "[redacted]" : field.valueBefore
    }));
    await navigator.clipboard.writeText(JSON.stringify(redacted, null, 2));
    copyButton.textContent = "Copied";
  });

  panel.append(header);

  const siteNote = siteNoteSection(result.site);
  if (siteNote) panel.append(siteNote);

  panel.append(
    mappingSection("Filled", result.filled),
    mappingSection("Unsure", result.unsure),
    mappingSection("Skipped", result.skipped),
    missingSection(result.missingRequired)
  );

  return panel;
}

/**
 * Honest caveats for sites this version only partly supports. Being upfront
 * here matters more than looking capable: a user who trusts a green "Filled"
 * count on Workday will submit a half-empty application.
 */
const SITE_NOTES: Record<string, { title: string; points: string[] }> = {
  workday: {
    title: "Workday support is partial",
    points: [
      'Text fields fill normally. Workday dropdowns do not: they are custom button[aria-haspopup="listbox"] widgets, not real <select> elements, and this version cannot fill them.',
      "Workday is a multi-step wizard. Only the current step is scanned, so run autofill again after each Next.",
      "Read every page before you submit. Nothing here clicks Continue, Submit, or uploads a resume."
    ]
  }
};

function siteNoteSection(site: string): HTMLElement | null {
  const note = SITE_NOTES[site];
  if (!note) return null;

  const section = document.createElement("section");
  section.className = "eam-section eam-note";
  section.innerHTML = `
    <h3 class="eam-note-title">Heads up: ${escapeHtml(note.title)}</h3>
    <ul class="eam-note-list">
      ${note.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}
    </ul>
  `;
  return section;
}

function mappingSection(title: string, mappings: FieldMapping[]): HTMLElement {
  const section = document.createElement("section");
  section.className = "eam-section";
  section.innerHTML = `<h3>${title}</h3>`;

  if (mappings.length === 0) {
    section.append(empty("Nothing here."));
    return section;
  }

  const list = document.createElement("ul");
  list.className = "eam-list";
  for (const mapping of mappings) {
    const item = document.createElement("li");
    item.className = "eam-item";
    item.innerHTML = `
      <div class="eam-label">${escapeHtml(mapping.labelText || mapping.kind)}</div>
      <div class="eam-meta">${escapeHtml(mapping.kind)} · ${escapeHtml(mapping.confidence)} · ${escapeHtml(mapping.reason)}</div>
      ${mapping.value !== undefined ? `<div class="eam-value">${escapeHtml(maskValue(mapping.kind, mapping.value))}</div>` : ""}
    `;
    list.append(item);
  }
  section.append(list);
  return section;
}

function missingSection(fields: DetectedField[]): HTMLElement {
  const section = document.createElement("section");
  section.className = "eam-section";
  section.innerHTML = "<h3>Missing Required</h3>";

  if (fields.length === 0) {
    section.append(empty("No required empty fields detected."));
    return section;
  }

  const list = document.createElement("ul");
  list.className = "eam-list";
  for (const field of fields) {
    const item = document.createElement("li");
    item.className = "eam-item";
    item.innerHTML = `
      <div class="eam-label">${escapeHtml(field.labelText || field.name || field.id)}</div>
      <div class="eam-meta">${escapeHtml(field.elementType)} · ${escapeHtml(field.name ?? "")}</div>
    `;
    list.append(item);
  }
  section.append(list);
  return section;
}

function empty(text: string): HTMLElement {
  const node = document.createElement("div");
  node.className = "eam-empty";
  node.textContent = text;
  return node;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function maskValue(kind: string, value: string): string {
  if (kind === "email") return value.replace(/^(.{2}).*(@.*)$/, "$1***$2");
  if (kind === "phone") return value.replace(/\d(?=\d{2})/g, "*");
  return value;
}
