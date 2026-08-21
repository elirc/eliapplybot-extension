import { beforeEach, describe, expect, it } from "vitest";
import { clearCombobox, restoreComboboxValue, selectComboboxValue } from "./combobox";
import { hostileCombobox, hostileComboboxDisplay, loadHostilePage, openMenus } from "./hostileFixture";
import type { WidgetTiming } from "./widgets";

// Shorter than the production budgets so the failure paths do not dominate the
// suite; the async fixture field still answers 250ms late, well inside these.
const FAST: WidgetTiming = {
  openBudgetMs: 400,
  optionsBudgetMs: 700,
  verifyBudgetMs: 200,
  pollIntervalMs: 10
};

beforeEach(() => {
  loadHostilePage();
});

describe("selectComboboxValue", () => {
  it("opens a mousedown-only widget from the keyboard and picks the exact option", async () => {
    const control = hostileCombobox("work_auth");

    const outcome = await selectComboboxValue(control, "Yes", FAST);

    expect(outcome).toEqual({ ok: true, value: "Yes", changed: true });
    expect(hostileComboboxDisplay("work_auth")).toBe("Yes");
    expect(openMenus()).toHaveLength(0);
  });

  it("documents why element.click() is never used to open a menu", () => {
    const control = hostileCombobox("work_auth");

    // No mousedown, so the real widget never sees the interaction at all.
    control.click();
    control.parentElement?.click();

    expect(openMenus()).toHaveLength(0);
    expect(control.getAttribute("aria-expanded")).toBe("false");
  });

  it("finds a listbox rendered in a portal outside the field's own subtree", async () => {
    const control = hostileCombobox("location");
    const section = document.querySelector("[data-select-field='location']")!;

    const outcome = await selectComboboxValue(control, "Remote", FAST);

    expect(outcome.ok).toBe(true);
    expect(section.querySelector("[role='listbox']")).toBeNull();
    expect(hostileComboboxDisplay("location")).toBe("Remote");
  });

  it("refuses a near match instead of choosing something close", async () => {
    // The only "yes" on offer is "Yes, with sponsorship" — a different answer.
    const control = hostileCombobox("sponsorship_trap");

    const outcome = await selectComboboxValue(control, "Yes", FAST);

    expect(outcome).toEqual({ ok: false, reason: "no-exact-match" });
    expect(hostileComboboxDisplay("sponsorship_trap")).toBe("");
    expect(control.value).toBe("");
    expect(openMenus()).toHaveLength(0);
    expect(control.getAttribute("aria-expanded")).toBe("false");
  });

  it("still selects the longer option when that is what was asked for", async () => {
    const control = hostileCombobox("sponsorship_trap");

    const outcome = await selectComboboxValue(control, "Yes, with sponsorship", FAST);

    expect(outcome.ok).toBe(true);
    expect(hostileComboboxDisplay("sponsorship_trap")).toBe("Yes, with sponsorship");
  });

  it("waits for options that arrive after the menu opens", async () => {
    const control = hostileCombobox("school");

    // The menu is empty for the first 250ms. Treating that as "no match" would
    // report every async dropdown as unfillable.
    const outcome = await selectComboboxValue(control, "Example University", FAST);

    expect(outcome.ok).toBe(true);
    expect(hostileComboboxDisplay("school")).toBe("Example University");
  });

  it("types to filter a virtualized list whose match is not rendered yet", async () => {
    const control = hostileCombobox("alma_mater");

    const outcome = await selectComboboxValue(control, "Example University", FAST);

    expect(outcome.ok).toBe(true);
    expect(hostileComboboxDisplay("alma_mater")).toBe("Example University");
  });

  it("fails gracefully when the menu never opens", async () => {
    const control = hostileCombobox("stubborn");

    const outcome = await selectComboboxValue(control, "New York", FAST);

    expect(outcome).toEqual({ ok: false, reason: "menu-did-not-open" });
    expect(hostileComboboxDisplay("stubborn")).toBe("");
    expect(control.value).toBe("");
  });

  it("reports failure for a value no option carries", async () => {
    const control = hostileCombobox("work_auth");

    const outcome = await selectComboboxValue(control, "Maybe", FAST);

    expect(outcome).toEqual({ ok: false, reason: "no-exact-match" });
    expect(hostileComboboxDisplay("work_auth")).toBe("");
  });

  it("reports an unchanged selection when the value is already displayed", async () => {
    const control = hostileCombobox("work_auth");
    await selectComboboxValue(control, "No", FAST);

    const outcome = await selectComboboxValue(control, "No", FAST);

    expect(outcome).toEqual({ ok: true, value: "No", changed: false });
  });
});

describe("combobox rollback", () => {
  it("clears back to empty through the widget's own clear control", async () => {
    const control = hostileCombobox("work_auth");
    await selectComboboxValue(control, "Yes", FAST);
    expect(hostileComboboxDisplay("work_auth")).toBe("Yes");

    expect(clearCombobox(control)).toBe(true);
    expect(hostileComboboxDisplay("work_auth")).toBe("");
  });

  it("admits it when a value cannot be cleared synchronously", async () => {
    const control = hostileCombobox("school");
    await selectComboboxValue(control, "Example University", FAST);

    // This widget offers no clear control, so there is nothing honest to do.
    expect(clearCombobox(control)).toBe(false);
    expect(hostileComboboxDisplay("school")).toBe("Example University");
  });

  it("restores a previously displayed value by re-selecting it", async () => {
    const control = hostileCombobox("location");
    await selectComboboxValue(control, "Remote", FAST);
    await selectComboboxValue(control, "San Francisco, CA", FAST);
    expect(hostileComboboxDisplay("location")).toBe("San Francisco, CA");

    const restored = await restoreComboboxValue(control, "Remote", FAST);

    expect(restored).toBe(true);
    expect(hostileComboboxDisplay("location")).toBe("Remote");
  });
});

describe("refusals leave the page as they found it", () => {
  it("does not adopt a menu that another question already had open", async () => {
    // The stubborn control's own menu never opens. A foreign menu offering the
    // same value is open elsewhere — adopting it would click an answer into a
    // different question and report nothing about having done so.
    const foreignHost = document.createElement("div");
    foreignHost.innerHTML = `
      <div role="listbox" id="someone-elses-menu">
        <div role="option">Yes</div>
        <div role="option">No</div>
      </div>`;
    document.body.append(foreignHost);
    const foreignOption = foreignHost.querySelector<HTMLElement>("[role='option']")!;
    let foreignClicks = 0;
    foreignOption.addEventListener("click", () => {
      foreignClicks += 1;
    });

    const outcome = await selectComboboxValue(hostileCombobox("stubborn"), "Yes", FAST);

    expect(outcome).toEqual({ ok: false, reason: "menu-did-not-open" });
    expect(foreignClicks).toBe(0);
  });

  it("puts back text the user had typed when it refuses", async () => {
    // A value-holding autocomplete the user already typed into. Filtering
    // overwrites that text, so a refusal has to restore it, not blank the field.
    const control = hostileCombobox("location");
    control.value = "Austin";

    const outcome = await selectComboboxValue(control, "Nowhere In This List", FAST);

    expect(outcome.ok).toBe(false);
    expect(control.value).toBe("Austin");
  });
});
