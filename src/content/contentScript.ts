import { fillField, rollbackFilled, rollbackFilledAsync, type RollbackEntry } from "./filler";
import { findFieldElements, findFieldNodes, scanPage } from "./scanner";
import { getComboboxDisplayValue, isChoiceButtonPressed } from "./widgets";
import { shouldFill } from "../shared/confidence";
import { mapFields } from "../shared/fieldMatchers";
import {
  MessageTypes,
  describeEmbeddedBoard,
  type ContentRequest,
  type ContentResponse,
  type EmbeddedBoard
} from "../shared/messages";
import { getActiveProfile, getActiveProfileName, isSampleProfile } from "../shared/storage";
import type { DetectedField, FieldMapping, FillResult } from "../shared/types";
import { getSiteAdapter } from "../sites";
import { renderSidebar } from "../sidebar/renderSidebar";

// The popup injects this script on demand; guard against running twice in one page.
declare global {
  interface Window {
    __eliApplyMateLoaded?: boolean;
  }
}

if (!window.__eliApplyMateLoaded) {
  window.__eliApplyMateLoaded = true;
  initContentScript();
}

function initContentScript(): void {
  const rollbackEntries: RollbackEntry[] = [];
  let lastResult: FillResult | null = null;

  chrome.runtime.onMessage.addListener(
    (request: ContentRequest, _sender, sendResponse: (response: ContentResponse) => void) => {
      handleRequest(request)
        .then(sendResponse)
        .catch((error: unknown) => {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        });
      return true;
    }
  );

  async function handleRequest(request: ContentRequest): Promise<ContentResponse> {
    if (request.type === MessageTypes.Ping) {
      return { ok: true, ready: true };
    }

    if (request.type === MessageTypes.Clear) {
      // The message path can wait for a widget to reopen its menu, so it clears
      // strictly more than the sidebar button's synchronous path can.
      const cleared = await rollbackFilledAsync(rollbackEntries);
      return { ok: true, cleared };
    }

    if (request.type === MessageTypes.ShowLastResult) {
      if (!lastResult) {
        return { ok: false, error: "Nothing to show yet. Run Autofill or Detect first." };
      }
      renderSidebar(lastResult, () => rollbackFilled(rollbackEntries));
      return { ok: true, result: lastResult };
    }

    const profile = await getActiveProfile();
    const profileName = await getActiveProfileName();

    // Detect stays available with the placeholder profile so a page can be explored
    // safely, but filling it into a real application would send a fake identity.
    if (request.type === MessageTypes.Autofill && isSampleProfile(profile)) {
      return {
        ok: false,
        error:
          `Nothing was filled: profile "${profileName}" still holds the placeholder sample data. ` +
          "Open Manage profile versions, replace the sample name and email with your real details, then run Autofill again."
      };
    }

    const adapter = getSiteAdapter(window.location.href);
    const detected = scanPage(adapter);

    // Greenhouse/Lever/Ashby/Workday forms are often embedded in a cross-origin iframe
    // on a company careers page. If this frame has nothing fillable but hosts one of
    // those boards, point at the frame URL instead of reporting an empty page.
    if (detected.length === 0) {
      const embedded = findEmbeddedBoards();
      if (embedded.length > 0) return { ok: true, embedded };
    }

    const mappings = mapFields(detected, profile);

    if (request.type === MessageTypes.Detect) {
      lastResult = {
        filled: [],
        skipped: mappings.filter((mapping) => mapping.confidence === "skip"),
        unsure: mappings.filter((mapping) => mapping.confidence !== "skip"),
        missingRequired: findMissingRequired(detected),
        detected,
        site: adapter.name,
        profileName
      };
      renderSidebar(lastResult, () => rollbackFilled(rollbackEntries));
      return { ok: true, detected };
    }

    const filled: FieldMapping[] = [];
    const skipped: FieldMapping[] = [];
    const unsure: FieldMapping[] = [];

    if (request.type === MessageTypes.Autofill) {
      for (const mapping of mappings) {
        const field = detected.find((candidate) => candidate.id === mapping.fieldId);
        if (!field) continue;

        if (mapping.confidence === "skip") {
          skipped.push(mapping);
          continue;
        }

        if (!shouldFill(mapping.confidence)) {
          unsure.push(mapping);
          continue;
        }

        const didFill = await fillField(mapping, field, rollbackEntries);
        if (didFill) {
          filled.push(mapping);
        } else {
          unsure.push({
            ...mapping,
            confidence: "medium" as const,
            reason: `${mapping.reason} Could not find a matching visible control option to fill.`
          });
        }
      }
    }

    lastResult = {
      filled,
      skipped,
      unsure,
      missingRequired: findMissingRequired(detected),
      detected,
      site: adapter.name,
      profileName
    };
    renderSidebar(lastResult, () => rollbackFilled(rollbackEntries));
    return { ok: true, result: lastResult };
  }
}

function findEmbeddedBoards(): EmbeddedBoard[] {
  const boards: EmbeddedBoard[] = [];
  const seen = new Set<string>();
  for (const frame of Array.from(document.querySelectorAll("iframe"))) {
    const board = describeEmbeddedBoard(frame.getAttribute("src"), document.baseURI);
    if (!board || seen.has(board.url)) continue;
    seen.add(board.url);
    boards.push(board);
  }
  return boards;
}

function findMissingRequired(fields: DetectedField[]): DetectedField[] {
  return fields.filter((field) => {
    if (!field.required) return false;

    if (field.elementType === "combobox") {
      const control = findFieldNodes(field.id)[0];
      // A react-select input's own value is always empty; the chosen option is
      // rendered next to it, so reading `.value` would report every filled
      // dropdown as still missing.
      return control ? !getComboboxDisplayValue(control) : false;
    }

    if (field.elementType === "buttongroup") {
      const buttons = findFieldNodes(field.id);
      return buttons.length > 0 && !buttons.some(isChoiceButtonPressed);
    }

    const elements = findFieldElements(field.id);
    if (elements.length === 0) return false;

    if (field.elementType === "radio" || field.elementType === "checkbox") {
      return !elements.some((element) => element instanceof HTMLInputElement && element.checked);
    }

    const element = elements[0];
    return !element.value;
  });
}
