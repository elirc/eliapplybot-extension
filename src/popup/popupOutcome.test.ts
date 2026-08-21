import { describe, expect, it } from "vitest";
import type { ContentResponse } from "../shared/messages";
import type { FieldMapping, FillResult } from "../shared/types";
import { aggregate, friendlyError } from "./Popup";

function mapping(fieldId: string): FieldMapping {
  return { fieldId, kind: "email", confidence: "high", reason: "test" };
}

function fillResult(counts: { filled?: number; unsure?: number; skipped?: number; detected?: number }): FillResult {
  const make = (prefix: string, count = 0) => Array.from({ length: count }, (_, index) => mapping(`${prefix}-${index}`));
  return {
    filled: make("filled", counts.filled),
    unsure: make("unsure", counts.unsure),
    skipped: make("skipped", counts.skipped),
    missingRequired: [],
    detected: Array.from({ length: counts.detected ?? 0 }, (_, index) => ({
      id: `field-${index}`,
      elementType: "input" as const,
      labelText: "Field"
    })),
    site: "greenhouse",
    profileName: "Default"
  };
}

describe("aggregate", () => {
  it("sums fill counts across frames instead of taking the first answer", () => {
    const responses: ContentResponse[] = [
      { ok: true, result: fillResult({ filled: 0, detected: 0 }) },
      { ok: true, result: fillResult({ filled: 6, unsure: 2, skipped: 1, detected: 11 }) }
    ];
    const outcome = aggregate(responses);
    expect(outcome.kind).toBe("result");
    expect(outcome.frames).toBe(2);
    expect(outcome.filled).toBe(6);
    expect(outcome.unsure).toBe(2);
    expect(outcome.skipped).toBe(1);
    expect(outcome.fieldsSeen).toBe(11);
  });

  it("sums detected fields and cleared controls across frames", () => {
    const detectOutcome = aggregate([
      { ok: true, detected: [] },
      { ok: true, detected: fillResult({ detected: 4 }).detected }
    ]);
    expect(detectOutcome.kind).toBe("detected");
    expect(detectOutcome.detected).toBe(4);

    const clearOutcome = aggregate([
      { ok: true, cleared: 2 },
      { ok: true, cleared: 3 }
    ]);
    expect(clearOutcome.kind).toBe("cleared");
    expect(clearOutcome.cleared).toBe(5);
  });

  it("collects embedded boards once, de-duplicated by URL", () => {
    const board = { ats: "Greenhouse", host: "boards.greenhouse.io", url: "https://boards.greenhouse.io/acme/jobs/1" };
    const outcome = aggregate([
      { ok: true, embedded: [board] },
      { ok: true, embedded: [board] }
    ]);
    expect(outcome.kind).toBe("none");
    expect(outcome.fieldsSeen).toBe(0);
    expect(outcome.embedded).toEqual([board]);
  });

  it("keeps per-frame errors without discarding a working frame's result", () => {
    const outcome = aggregate([
      { ok: false, error: "Could not establish connection. Receiving end does not exist." },
      { ok: true, result: fillResult({ filled: 3, detected: 5 }) }
    ]);
    expect(outcome.kind).toBe("result");
    expect(outcome.filled).toBe(3);
    expect(outcome.frames).toBe(1);
    expect(outcome.errors).toHaveLength(1);
  });

  it("reports nothing usable when every frame failed", () => {
    const outcome = aggregate([{ ok: false, error: "boom" }]);
    expect(outcome.kind).toBe("none");
    expect(outcome.embedded).toEqual([]);
    expect(outcome.errors).toEqual(["boom"]);
  });
});

describe("friendlyError", () => {
  it("rewrites known Chrome messaging errors", () => {
    expect(friendlyError("Could not establish connection. Receiving end does not exist.")).toMatch(/Reload the page/);
    expect(friendlyError("The message port closed before a response was received.")).toMatch(/Reload the page/);
    expect(friendlyError("Frame with ID 3 was removed.")).toMatch(/Reload the page/);
  });

  it("rewrites known injection and permission errors", () => {
    expect(friendlyError("Cannot access contents of url \"chrome://extensions\".")).toMatch(/http\/https tab/);
    expect(friendlyError("Missing host permission for the tab")).toMatch(/http\/https tab/);
    expect(friendlyError("No tab with id: 42.")).toMatch(/tab is gone/);
  });

  it("passes unknown errors through unchanged", () => {
    expect(friendlyError("Profile version no longer exists.")).toBe("Profile version no longer exists.");
  });

  it("falls back to generic guidance for an empty message", () => {
    expect(friendlyError("")).toMatch(/Something went wrong/);
  });
});
