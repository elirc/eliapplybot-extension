import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanPage } from "../../src/content/scanner";
import { fillField, rollbackFilled, type RollbackEntry } from "../../src/content/filler";
import { mapField, mapFields } from "../../src/shared/fieldMatchers";
import { shouldFill } from "../../src/shared/confidence";
import { sampleProfile } from "../../src/shared/sampleProfile";
import { validateProfileDetailed } from "../../src/shared/profileSchema";
import { installChromeMock } from "../../src/test/chromeMock";
import { createProfile, getStore, updateProfile, setActiveProfile } from "../../src/shared/storage";
import type { CandidateProfile, DetectedField } from "../../src/shared/types";

// Passing probes confirm the reported CURRENT behavior; they are not acceptance tests.
beforeEach(() => {
  document.body.innerHTML = "";
  document.getElementById("eli-apply-mate-sidebar")?.remove();
  vi.restoreAllMocks();
});

function fill(profile = sampleProfile) {
  const detected = scanPage();
  const mappings = mapFields(detected, profile);
  const rollback: RollbackEntry[] = [];
  const outcomes = mappings.map((mapping, index) => ({ mapping,
    filled: shouldFill(mapping.confidence) && fillField(mapping, detected[index], rollback) }));
  return { detected, mappings, rollback, outcomes };
}

function map(labelText: string, extra: Partial<DetectedField> = {}, profile = sampleProfile) {
  return mapField({ id: "probe", elementType: "input", labelText, ...extra }, profile);
}

async function contentHarness() {
  const mock = installChromeMock();
  await getStore();
  let listener: any;
  (chrome as any).runtime = { onMessage: { addListener: (fn: any) => { listener = fn; } } };
  delete (window as any).__eliApplyMateLoaded;
  // Exercise the actual packaged content script, including sidebar and routing.
  new Function(readFileSync(resolve("dist/contentScript.js"), "utf8"))();
  return { mock, request: (type: string) => new Promise<any>((resolveResponse) => listener({ type }, {}, resolveResponse)) };
}

describe("Observed matching and filling defects", () => {
  it("R01 repeated scans reuse an ID held by a now-hidden control and fill that hidden control", () => {
    document.body.innerHTML = '<label>First name<input id="old"></label><label>Last name<input id="live"></label>';
    scanPage();
    document.querySelector<HTMLInputElement>("#old")!.hidden = true;
    const result = fill();
    expect(result.outcomes[0].filled).toBe(true);
    expect(document.querySelector<HTMLInputElement>("#old")!.value).toBe(sampleProfile.personal.lastName);
    expect(document.querySelector<HTMLInputElement>("#live")!.value).toBe("");
  });

  it.each(["United Kingdom", "Canada", "Germany"])("R02 US authorization is used for a %s question", (country) => {
    expect(map(`Are you legally authorized to work in ${country}?`, { elementType: "select", options: ["Yes", "No"] }))
      .toMatchObject({ confidence: "high", kind: "workAuthorization", value: "Yes" });
  });

  it("R02 a negated authorization question gets the uninverted Yes answer", () => {
    expect(map("Are you NOT legally authorized to work in the United States?", { elementType: "select", options: ["Yes", "No"] }))
      .toMatchObject({ confidence: "high", value: "Yes" });
  });

  it.each(["Reference email", "Emergency contact email", "Email password"])("R03 %s is classified as candidate email", (label) => {
    expect(map(label)).toMatchObject({ confidence: "high", kind: "email", value: sampleProfile.personal.email });
  });

  it("R03 a job-specific short input is filled from personal data", () => {
    expect(map("Why do you want to work for this company?"))
      .toMatchObject({ confidence: "high", kind: "experienceCompany", value: sampleProfile.experience[0].company });
  });

  it("R04 mailing address receives a city/state string", () => {
    expect(map("Mailing address")).toMatchObject({ confidence: "high", value: "San Francisco, CA" });
  });

  it("R05 a school fieldset legend overrides its degree label", () => {
    document.body.innerHTML = '<fieldset><legend>School information</legend><label>Degree<input></label></fieldset>';
    const result = fill();
    expect(result.mappings[0]).toMatchObject({ confidence: "high", kind: "educationSchool" });
    expect(document.querySelector("input")!.value).toBe(sampleProfile.education[0].school);
  });

  it("R05 education context from another section overrides an employment date", () => {
    document.body.innerHTML = '<form><section><h2>Education</h2><label>School<input></label></section><section><h2>Employment</h2><label>Start date<input id="work"></label></section></form>';
    const result = fill();
    expect(result.mappings.find((m) => m.fieldId === document.querySelector("#work")!.getAttribute("data-eli-apply-mate-field-id")))
      .toMatchObject({ confidence: "high", kind: "educationStartDate" });
    expect(document.querySelector<HTMLInputElement>("#work")!.value).toBe("09/2016");
  });

  it("R06 both employment entries receive the first company", () => {
    const profile = structuredClone(sampleProfile);
    profile.experience.push({ ...profile.experience[0], company: "Second Employer" });
    document.body.innerHTML = '<section><h2>Employment</h2><label>Company<input name="experience_0_company"></label><label>Company<input name="experience_1_company"></label></section>';
    fill(profile);
    expect(Array.from(document.querySelectorAll("input"), (i) => i.value)).toEqual([profile.experience[0].company, profile.experience[0].company]);
  });

  it.each(["date", "month", "number"])("R07 a %s date control is cleared but reported as filled", (type) => {
    document.body.innerHTML = `<section><h2>Education</h2><label>Start date<input type="${type}" value="${type === "date" ? "2020-01-01" : type === "month" ? "2020-01" : "2020"}"></label></section>`;
    expect(fill().outcomes[0].filled).toBe(true);
    expect(document.querySelector("input")!.value).toBe("");
  });

  it.each(["disabled", "readonly", 'type="password"'])("R08 %s controls can be overwritten", (attribute) => {
    document.body.innerHTML = `<label>Email<input ${attribute} value="existing"></label>`;
    expect(fill().outcomes[0].filled).toBe(true);
    expect(document.querySelector("input")!.value).toBe(sampleProfile.personal.email);
  });

  it("R08 an empty saved name clears a pre-existing value and is counted as filled", () => {
    const profile = structuredClone(sampleProfile);
    profile.personal.firstName = "";
    document.body.innerHTML = '<label>First name<input value="User supplied"></label>';
    expect(validateProfileDetailed(profile).valid).toBe(true);
    expect(fill(profile).outcomes[0].filled).toBe(true);
    expect(document.querySelector("input")!.value).toBe("");
  });

  it("R09 a nearby upload causes an ordinary name field to be skipped", () => {
    document.body.innerHTML = '<form>\n<label>First name<input></label>\n<label>Resume<input type="file"></label>\n</form>';
    expect(fill().mappings[0].confidence).toBe("skip");
    expect(document.querySelector("input")!.value).toBe("");
  });

  it("R10 radio labels are combined with machine values and stop yes/no matching", () => {
    document.body.innerHTML = '<fieldset><legend>Authorized to work in the United States?</legend><label><input type="radio" name="auth" value="1">Yes</label><label><input type="radio" name="auth" value="0">No</label></fieldset>';
    const result = fill();
    expect(result.detected[0].options).toEqual(["Yes 1", "No 0"]);
    expect(result.mappings[0].confidence).toBe("medium");
    expect(document.querySelector<HTMLInputElement>("input")!.checked).toBe(false);
  });

  it("R10 true/false options are accepted by matching but cannot be filled", () => {
    document.body.innerHTML = '<label>Authorized to work in the United States?<select><option value="">Choose</option><option>true</option><option>false</option></select></label>';
    const result = fill();
    expect(result.mappings[0].confidence).toBe("high");
    expect(result.outcomes[0].filled).toBe(false);
  });

  it.each(["C++", "C#"])("R11 %s years matches the category but loses its saved value", (skill) => {
    const profile = structuredClone(sampleProfile);
    profile.experienceYears = { [skill]: 6 };
    expect(map(`Years of ${skill} experience`, {}, profile)).toMatchObject({ kind: "yearsOfExperience", confidence: "medium" });
  });

  it("R24 a conventional Name label with name=name is not recognized", () => {
    expect(map("Name", { name: "name" })).toMatchObject({ kind: "unknown", confidence: "low" });
    expect(map("Surname", { name: "surname" })).toMatchObject({ kind: "unknown", confidence: "low" });
  });

  it("R12 clearing after two fills reverts both runs and removes later manual edits", () => {
    document.body.innerHTML = '<label>First name<input value="Original"></label>';
    const first = fill();
    document.querySelector("input")!.value = "Manual correction";
    const fields = scanPage();
    const profile = structuredClone(sampleProfile);
    profile.personal.firstName = "Second run";
    fillField(mapFields(fields, profile)[0], fields[0], first.rollback);
    expect(rollbackFilled(first.rollback)).toBe(2);
    expect(document.querySelector("input")!.value).toBe("Original");
  });

  it("R13 invalid contact formats and contradictory dates pass profile validation", () => {
    const profile = structuredClone(sampleProfile);
    profile.personal.email = "not-an-email";
    profile.personal.linkedin = "not-a-url";
    profile.education[0].end = { month: 1, year: 2010 };
    profile.experience[0].current = false;
    profile.experience[0].end = null;
    expect(validateProfileDetailed(profile)).toEqual({ valid: true, errors: [] });
  });
});

describe("Observed storage defects", () => {
  it("R14 one invalid stored profile causes all saved versions to be replaced", async () => {
    const mock = installChromeMock();
    await getStore();
    await createProfile("Important profile");
    (mock.data.profileStore as any).profiles[0].profile.education[0].start.month = 99;
    const recovered = await getStore();
    expect(recovered.profiles.map((p) => p.name)).toEqual(["Default"]);
    expect((mock.data.profileStore as any).profiles).toHaveLength(1);
  });

  it("R15 concurrent successful profile creations lose one profile", async () => {
    installChromeMock();
    await getStore();
    await Promise.all([createProfile("Concurrent A"), createProfile("Concurrent B")]);
    const store = await getStore();
    expect(store.profiles).toHaveLength(2);
    expect(store.profiles.map((p) => p.name)).not.toContain("Concurrent A");
  });

  it("R15 a concurrent active-profile switch can discard a successful content save", async () => {
    installChromeMock();
    const initial = await getStore();
    const second = await createProfile("Second");
    const edited = structuredClone(sampleProfile);
    edited.personal.firstName = "Updated";
    await Promise.all([updateProfile(initial.profiles[0].id, edited), setActiveProfile(second.id)]);
    expect((await getStore()).profiles[0].profile.personal.firstName).toBe("Alex");
  });
});

describe("Packaged content script and sidebar", () => {
  it("R16 first-run autofill inserts sample identity without an in-app setup gate", async () => {
    const harness = await contentHarness();
    document.body.innerHTML = '<label>First name<input required></label>';
    const result = await harness.request("EAM_AUTOFILL");
    expect(result.ok).toBe(true);
    expect(result.result.filled).toHaveLength(1);
    expect(document.querySelector("input")!.value).toBe("Alex");
  });

  it("R17 unrelated unnamed checkboxes collapse and hide a missing required consent", async () => {
    const harness = await contentHarness();
    document.body.innerHTML = '<form><label><input type="checkbox" checked>Newsletter</label><label><input type="checkbox" required>Accept terms</label></form>';
    const result = await harness.request("EAM_AUTOFILL");
    expect(result.result.detected).toHaveLength(1);
    expect(result.result.missingRequired).toHaveLength(0);
    expect(document.querySelectorAll<HTMLInputElement>("input")[1].validity.valueMissing).toBe(true);
  });

  it("R18 clear restores an empty required input but sidebar still says filled and complete", async () => {
    const harness = await contentHarness();
    document.body.innerHTML = '<label>First name<input required></label>';
    await harness.request("EAM_AUTOFILL");
    await harness.request("EAM_CLEAR");
    const result = await harness.request("EAM_SHOW_LAST_RESULT");
    expect(document.querySelector("input")!.value).toBe("");
    expect(result.result.filled).toHaveLength(1);
    expect(result.result.missingRequired).toHaveLength(0);
  });

  it("R19 debug copy retains private nearby text despite redacting valueBefore", async () => {
    const harness = await contentHarness();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    document.body.innerHTML = '<div><span>Applicant private note: synthetic-secret-123</span><label>First name<input value="Typed name"></label></div>';
    await harness.request("EAM_DETECT");
    const shadow = document.getElementById("eli-apply-mate-sidebar")!.shadowRoot!;
    (shadow.querySelector('[data-action="copy"]') as HTMLButtonElement).click();
    await Promise.resolve();
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain("synthetic-secret-123");
    expect(copied).toContain("[redacted]");
    expect(copied).not.toContain("Typed name");
  });

  it("R19 detect exposes an unfilled profile value in page-readable shadow DOM", async () => {
    const harness = await contentHarness();
    document.body.innerHTML = '<label>Mailing address<input></label>';
    await harness.request("EAM_DETECT");
    expect(document.querySelector("input")!.value).toBe("");
    expect(document.getElementById("eli-apply-mate-sidebar")!.shadowRoot!.textContent).toContain("San Francisco, CA");
  });

  it("R20 scanner omits controls inside a shadow root", () => {
    const host = document.createElement("div");
    document.body.append(host);
    host.attachShadow({ mode: "open" }).innerHTML = '<label>First name<input required></label>';
    expect(scanPage()).toHaveLength(0);
  });

  it("R20 scanner omits controls inside a same-origin iframe", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    frame.contentDocument!.body.innerHTML = '<label>First name<input required></label>';
    expect(scanPage()).toHaveLength(0);
  });

  it("Positive control: sidebar escapes hostile field labels", async () => {
    const harness = await contentHarness();
    document.body.innerHTML = '<label>&lt;img src=x onerror=alert(1)&gt; First name<input></label>';
    await harness.request("EAM_DETECT");
    const shadow = document.getElementById("eli-apply-mate-sidebar")!.shadowRoot!;
    expect(shadow.querySelector("img")).toBeNull();
    expect(shadow.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("Positive control: packaged content script handles ping and missing last-result state", async () => {
    const harness = await contentHarness();
    expect(await harness.request("EAM_PING")).toEqual({ ok: true, ready: true });
    expect(await harness.request("EAM_SHOW_LAST_RESULT")).toMatchObject({ ok: false });
  });

  it("Positive control: packaged autofill does not click submit or populate file and essay controls", async () => {
    const harness = await contentHarness();
    document.body.innerHTML = '<form><section><label>First name<input></label></section><section><label>Resume<input type="file"></label><label>Why this company?<textarea></textarea></label></section><button type="submit">Submit</button></form>';
    const submit = vi.fn((event: Event) => event.preventDefault());
    document.querySelector("form")!.addEventListener("submit", submit);
    await harness.request("EAM_AUTOFILL");
    expect(document.querySelector<HTMLInputElement>('input[type="file"]')!.value).toBe("");
    expect(document.querySelector("textarea")!.value).toBe("");
    expect(submit).not.toHaveBeenCalled();
  });
});
