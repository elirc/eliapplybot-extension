import { afterEach, describe, expect, it } from "vitest";
import { renderSidebar } from "./renderSidebar";
import type { FillResult } from "../shared/types";

function result(overrides: Partial<FillResult> = {}): FillResult {
  return {
    filled: [],
    skipped: [],
    unsure: [],
    missingRequired: [],
    detected: [],
    site: "generic",
    profileName: "default",
    ...overrides
  };
}

function panelText(): string {
  const host = document.getElementById("eli-apply-mate-sidebar");
  return host?.shadowRoot?.textContent ?? "";
}

afterEach(() => {
  document.getElementById("eli-apply-mate-sidebar")?.remove();
});

describe("renderSidebar site notes", () => {
  it("warns that Workday support is partial", () => {
    renderSidebar(result({ site: "workday" }), () => 0);
    const text = panelText();
    expect(text).toContain("Workday support is partial");
    expect(text).toContain('button[aria-haspopup="listbox"]');
    expect(text).toContain("multi-step wizard");
  });

  it("shows no caveat on sites without one", () => {
    renderSidebar(result({ site: "greenhouse" }), () => 0);
    expect(panelText()).not.toContain("Heads up");
  });

  it("escapes dynamic text instead of injecting markup", () => {
    renderSidebar(
      result({
        site: "generic",
        profileName: "<img src=x onerror=alert(1)>",
        unsure: [
          {
            fieldId: "f1",
            kind: "unknown",
            confidence: "medium",
            reason: "<script>bad()</script>",
            labelText: "<b>Label</b>"
          }
        ]
      }),
      () => 0
    );
    const shadow = document.getElementById("eli-apply-mate-sidebar")?.shadowRoot;
    expect(shadow?.querySelector("img")).toBeNull();
    expect(shadow?.querySelector("script")).toBeNull();
    expect(shadow?.querySelector("b")).toBeNull();
    expect(panelText()).toContain("<b>Label</b>");
  });
});
