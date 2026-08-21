import { beforeEach, describe, expect, it } from "vitest";
import { shouldFill } from "../shared/confidence";
import { mapFields } from "../shared/fieldMatchers";
import { filledProfile } from "./testProfile";
import type { DetectedField, FieldMapping } from "../shared/types";
import { fillField, rollbackFilled, rollbackFilledAsync, type RollbackEntry } from "./filler";
import { hostileComboboxDisplay, loadHostilePage, openMenus } from "./hostileFixture";
import { scanPage } from "./scanner";

function fieldFor(fields: DetectedField[], labelFragment: string): DetectedField {
  const field = fields.find((candidate) => candidate.labelText.toLowerCase().includes(labelFragment.toLowerCase()));
  if (!field) throw new Error(`No detected field labelled like "${labelFragment}"`);
  return field;
}

type Run = {
  detected: DetectedField[];
  filled: FieldMapping[];
  unsure: FieldMapping[];
  rollback: RollbackEntry[];
};

async function autofill(): Promise<Run> {
  const detected = scanPage();
  const mappings = mapFields(detected, filledProfile);
  const rollback: RollbackEntry[] = [];
  const filled: FieldMapping[] = [];
  const unsure: FieldMapping[] = [];

  for (const mapping of mappings) {
    const field = detected.find((candidate) => candidate.id === mapping.fieldId);
    if (!field) continue;
    if (mapping.confidence === "skip") continue;
    if (!shouldFill(mapping.confidence)) {
      unsure.push(mapping);
      continue;
    }
    if (await fillField(mapping, field, rollback)) filled.push(mapping);
    else unsure.push(mapping);
  }

  return { detected, filled, unsure, rollback };
}

function clickCounter(selector: string): () => number {
  let clicks = 0;
  for (const node of document.querySelectorAll(selector)) node.addEventListener("click", () => (clicks += 1));
  return () => clicks;
}

beforeEach(() => {
  loadHostilePage();
});

describe("scanning the hostile application", () => {
  it("reports ARIA comboboxes as comboboxes, exactly once each", () => {
    const fields = scanPage();
    const comboboxes = fields.filter((field) => field.elementType === "combobox");

    expect(comboboxes.map((field) => field.labelText)).toEqual([
      "Are you legally authorized to work in the United States?",
      "Do you need visa sponsorship of any kind?",
      "School",
      "Location",
      "Previous school",
      "Which office do you prefer?"
    ]);
    // The same input must not also appear as a plain text input.
    expect(fields.filter((field) => field.idAttribute === "work_auth")).toHaveLength(1);
  });

  it("leaves combobox options undefined rather than opening menus to look", () => {
    const fields = scanPage();

    expect(fieldFor(fields, "School").options).toBeUndefined();
    expect(openMenus()).toHaveLength(0);
    expect(document.querySelectorAll("[aria-expanded='true']")).toHaveLength(0);
  });

  it("sees the required shim react-select hides inside the control", () => {
    const fields = scanPage();

    expect(fieldFor(fields, "legally authorized").required).toBe(true);
    expect(fieldFor(fields, "Previous school").required).toBeFalsy();
    // The shim itself is not a field.
    expect(fields.some((field) => field.inputType === "hidden")).toBe(false);
    expect(document.querySelectorAll(".select__requiredInput[data-eli-apply-mate-field-id]")).toHaveLength(0);
  });

  it("reads the question off the wrapper when label[for] points at nothing", () => {
    const fields = scanPage();

    // <label for="_systemfield_name"> and <label for="_systemfield_location">
    // both name ids that exist nowhere in the document.
    expect(document.getElementById("_systemfield_name")).toBeNull();
    expect(fieldFor(fields, "Full name").elementType).toBe("input");
    expect(fieldFor(fields, "Location").elementType).toBe("combobox");
  });

  it("treats an Ashby yes/no button pair as one choice field", () => {
    const fields = scanPage();
    const group = fieldFor(fields, "require sponsorship for employment");

    expect(group.elementType).toBe("buttongroup");
    expect(group.options).toEqual(["Yes", "No"]);
    expect(group.name).toBe("9822f66b-sponsorship");
    // The decoy checkbox beside the buttons is not reported separately.
    expect(fields.filter((field) => field.elementType === "checkbox")).toHaveLength(0);
  });

  it("never treats wizard navigation as a choice group", () => {
    const fields = scanPage();

    expect(fields.some((field) => field.options?.includes("Continue"))).toBe(false);
    expect(document.querySelectorAll(".button-group [data-eli-apply-mate-field-id]")).toHaveLength(0);
  });

  it("still groups an unnamed radio pair", () => {
    const fields = scanPage();
    const radios = fields.filter((field) => field.elementType === "radio");

    expect(radios).toHaveLength(1);
    expect(radios[0].options).toEqual(["Remote", "Onsite"]);
  });
});

describe("autofilling the hostile application", () => {
  it("fills text, comboboxes and an Ashby yes/no question", async () => {
    const { filled } = await autofill();

    expect(document.querySelector<HTMLInputElement>("#first_name")!.value).toBe("Dana");
    expect(document.querySelector<HTMLInputElement>(".ashby-input")!.value).toBe("Dana Ruiz");
    expect(hostileComboboxDisplay("location")).toBe("Austin, TX");
    expect(hostileComboboxDisplay("school")).toBe("Northwood University");
    expect(hostileComboboxDisplay("alma_mater")).toBe("Northwood University");

    const no = document.querySelector<HTMLButtonElement>(".ashby-application-form-input-yesno button[data-option='no']")!;
    const yes = document.querySelector<HTMLButtonElement>(".ashby-application-form-input-yesno button[data-option='yes']")!;
    expect(no.getAttribute("aria-pressed")).toBe("true");
    expect(yes.getAttribute("aria-pressed")).toBe("false");

    expect(filled.length).toBeGreaterThanOrEqual(6);
    expect(openMenus()).toHaveLength(0);
  });

  it("answers a yes/no combobox only when the exact option is really there", async () => {
    const { unsure } = await autofill();
    const labels = unsure.map((mapping) => mapping.labelText);

    // A yes/no combobox reports no options until its menu is opened, and Detect
    // must not open menus. The check therefore happens at fill time instead: the
    // driver opens the menu and clicks an option only if its text matches exactly.
    expect(hostileComboboxDisplay("work_auth")).toBe("Yes");

    // The trap offers only "Yes, with sponsorship" — a different answer to a visa
    // question. It must stay empty and be handed back for review.
    expect(hostileComboboxDisplay("sponsorship_trap")).toBe("");
    expect(labels).toContain("Do you need visa sponsorship of any kind?");
  });

  it("clicks nothing that could submit or advance the application", async () => {
    const submitClicks = clickCounter("#submit-application, #save-draft, .button-group button");

    await autofill();

    expect(submitClicks()).toBe(0);
  });

  it("restores what it can and refuses to claim the rest was cleared", async () => {
    const { filled, rollback } = await autofill();
    expect(rollback.some((entry) => entry.widget)).toBe(true);

    const cleared = await rollbackFilledAsync(rollback);

    expect(document.querySelector<HTMLInputElement>("#first_name")!.value).toBe("");
    expect(document.querySelector<HTMLInputElement>(".ashby-input")!.value).toBe("");

    // The school combobox offers no way back to "nothing selected". It must stay
    // in the log and must not be counted as cleared — under-reporting is correct,
    // claiming a field was cleared while it still holds our value is not.
    expect(hostileComboboxDisplay("school")).toBe("Northwood University");
    expect(rollback.length).toBeGreaterThan(0);
    expect(cleared).toBeLessThan(filled.length);
  });

  it("clears a combobox that does offer a clear control", async () => {
    const detected = scanPage();
    const work = fieldFor(detected, "legally authorized");
    const rollback: RollbackEntry[] = [];

    const ok = await fillField(
      { fieldId: work.id, kind: "workAuthorization", confidence: "high", reason: "test", value: "Yes" },
      work,
      rollback
    );

    expect(ok).toBe(true);
    expect(hostileComboboxDisplay("work_auth")).toBe("Yes");

    expect(rollbackFilled(rollback)).toBe(1);
    expect(hostileComboboxDisplay("work_auth")).toBe("");
    expect(rollback).toHaveLength(0);
  });
});
