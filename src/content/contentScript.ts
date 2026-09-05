import { fillField, rollbackFilled, type RollbackEntry } from "./filler";
import { findFieldElements, getScanWarnings, scanPage } from "./scanner";
import { mapFields } from "../shared/fieldMatchers";
import { MessageTypes, type ContentRequest, type ContentResponse } from "../shared/messages";
import { getActiveVersion } from "../shared/storage";
import type { DetectedField, FieldMapping, FillResult } from "../shared/types";
import { getSiteAdapter } from "../sites";
import { renderSidebar } from "../sidebar/renderSidebar";
import { isInput } from "./domLabels";

declare global { interface Window { __eliApplyMateLoaded?: boolean } }
if (!window.__eliApplyMateLoaded) { window.__eliApplyMateLoaded = true; initContentScript(); }

function initContentScript(): void {
  let rollbackEntries: RollbackEntry[] = [];
  let lastResult: FillResult | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const clear = async () => {
    const count = rollbackFilled(rollbackEntries);
    if (lastResult) {
      const detected = scanPage(getSiteAdapter(window.location.href));
      lastResult = { ...lastResult, filled: [], skipped: [], unsure: [], mode: "cleared", detected, missingRequired: findMissingRequired(detected), warnings: getScanWarnings() };
      renderSidebar(lastResult, () => enqueueClear());
    }
    return count;
  };
  const enqueueClear = () => {
    const next = queue.then(clear); queue = next.catch(() => undefined); return next;
  };
  chrome.runtime.onMessage.addListener((request: ContentRequest, sender, sendResponse: (response: ContentResponse) => void) => {
    if (!request || !Object.values(MessageTypes).includes(request.type)) return;
    if (sender.id && sender.id !== chrome.runtime.id) return;
    const next = queue.then(() => handle(request));
    queue = next.catch(() => undefined);
    next.then(sendResponse).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  });
  async function handle(request: ContentRequest): Promise<ContentResponse> {
    if (request.type === MessageTypes.Ping) return { ok: true, ready: true };
    if (request.type === MessageTypes.Clear) return { ok: true, cleared: await clear() };
    if (request.type === MessageTypes.ShowLastResult) {
      if (!lastResult) return { ok: false, error: "Nothing to show yet. Run Autofill or Detect first." };
      const fields = scanPage(getSiteAdapter(window.location.href));
      lastResult = { ...lastResult, missingRequired: findMissingRequired(fields), detected: fields };
      renderSidebar(lastResult, () => enqueueClear());
      return { ok: true, result: lastResult };
    }
    const active = await getActiveVersion();
    if (request.type === MessageTypes.Autofill && !active.configured) return { ok: false, error: "Complete and review this profile in Manage profiles before autofilling." };
    const adapter = getSiteAdapter(window.location.href);
    const detected = scanPage(adapter);
    const mappings = mapFields(detected, active.profile);
    const filled: FieldMapping[] = [], skipped: FieldMapping[] = [], unsure: FieldMapping[] = [];
    const batch: RollbackEntry[] = [];
    for (let index = 0; index < mappings.length; index++) {
      const mapping = mappings[index];
      if (mapping.confidence === "skip") skipped.push(mapping);
      else if (request.type === MessageTypes.Detect || mapping.confidence !== "high") unsure.push(mapping);
      else if (fillField(mapping, detected[index], batch)) filled.push(mapping);
      else unsure.push({ ...mapping, confidence: "medium", reason: "No change was accepted. Existing answers, changed controls, and invalid values are preserved." });
    }
    if (batch.length) rollbackEntries = batch;
    // Return structural review only. Profile values are never placed in page UI,
    // clipboard debug data, or a Detect response.
    const redact = (items: FieldMapping[]) => items.map(({ value: _value, ...mapping }) => mapping);
    lastResult = {
      filled: redact(filled), skipped: redact(skipped), unsure: redact(unsure),
      missingRequired: findMissingRequired(detected), detected, site: adapter.name,
      profileName: "", mode: request.type === MessageTypes.Detect ? "detect" : "fill", warnings: getScanWarnings()
    };
    renderSidebar(lastResult, () => enqueueClear());
    return request.type === MessageTypes.Detect ? { ok: true, detected } : { ok: true, result: lastResult };
  }
}
export function findMissingRequired(fields: DetectedField[]): DetectedField[] {
  return fields.filter((field) => {
    if (!field.required || field.disabled || field.readOnly) return false;
    const elements = findFieldElements(field.id);
    if (!elements.length) return false;
    if (field.elementType === "radio") return !elements.some((element) => isInput(element) && element.checked);
    if (field.elementType === "checkbox") return elements.some((element) => isInput(element) && !element.checked);
    return !elements[0].value.trim();
  });
}
