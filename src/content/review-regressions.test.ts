import { beforeEach, describe, expect, it } from "vitest";
import { scanPage, getScanWarnings } from "./scanner";
import { mapField, mapFields } from "../shared/fieldMatchers";
import { sampleProfile } from "../shared/sampleProfile";
import { fillField } from "./filler";
import { validateProfileDetailed } from "../shared/profileSchema";
import { debugFields } from "../sidebar/renderSidebar";
import type { DetectedField } from "../shared/types";

beforeEach(() => { document.body.innerHTML = ""; });
const map = (labelText: string, extra: Partial<DetectedField> = {}) => mapField({ id: "test", labelText, elementType: "input", ...extra }, sampleProfile);
function fillPage() {
  const fields = scanPage(); const mappings = mapFields(fields, sampleProfile);
  mappings.forEach((mapping, i) => fillField(mapping, fields[i], [])); return mappings;
}
describe("review regressions R01-R24", () => {
  it("R01 does not reuse a hidden input after a rescan", () => {
    document.body.innerHTML = '<label>First name<input id="old"></label><label>Last name<input id="live"></label>';
    scanPage(); document.querySelector<HTMLInputElement>("#old")!.hidden = true; fillPage();
    expect(document.querySelector<HTMLInputElement>("#old")!.value).toBe(""); expect(document.querySelector<HTMLInputElement>("#live")!.value).toBe("Example");
  });
  it.each(["United Kingdom", "Canada", "Germany"])("R02 does not infer authorization for %s", (country) => {
    expect(map(`Are you legally authorized to work in ${country}?`, { elementType: "select", options: ["Yes", "No"] }).confidence).toBe("medium");
  });
  it.each(["Are you NOT legally authorized to work in the United States?", "Are you authorized to work in the US without sponsorship?", "Will you require sponsorship?", "Are you authorized to work for us in France?", "Are you authorized to work in the US or France?", "Do you need no sponsorship in the United States?"])("R02 reviews ambiguous authorization: %s", (label) => {
    expect(map(label, { elementType: "select", options: ["Yes", "No"] }).confidence).not.toBe("high");
  });
  it.each(["Reference email", "Emergency contact email", "Email password", "Why do you want to work for this company?"])("R03 refuses %s", (label) => {
    expect(map(label).confidence).toBe("skip");
  });
  it("R04 does not guess a mailing address", () => { expect(map("Mailing address").value).toBeUndefined(); });
  it("R05 separates school legend from degree label", () => {
    document.body.innerHTML = '<fieldset><legend>School information</legend><label>Degree<input></label></fieldset>';
    fillPage(); expect(document.querySelector("input")!.value).toBe("Bachelor of Science");
  });
  it("R05 does not read education context from an earlier section", () => {
    document.body.innerHTML = '<form><section><h2>Education</h2><label>School<input></label></section><section><h2>Employment</h2><label>Start date<input id="work"></label></section></form>';
    fillPage(); expect(document.querySelector<HTMLInputElement>("#work")!.value).toBe("06/2022");
  });
  it("R06 leaves repeated history fields for manual association", () => {
    document.body.innerHTML = '<section><h2>Employment</h2><label>Company<input name="experience_0_company"></label><label>Company<input name="experience_1_company"></label></section>';
    expect(fillPage().every((m) => m.confidence === "medium")).toBe(true); expect(Array.from(document.querySelectorAll("input"), (i) => i.value)).toEqual(["", ""]);
  });
  it("R07 formats native month fields and split numeric years", () => {
    expect(map("Education start date", { inputType: "month" }).value).toBe("2016-09");
    expect(map("Education start year", { inputType: "number" }).value).toBe("2016");
    expect(map("Education start date", { inputType: "date" }).confidence).toBe("medium");
  });
  it("R07 maps school graduation dates to dates instead of school names", () => {
    expect(map("School graduation date", { inputType: "month" }).value).toBe("2020-05");
  });
  it("R03 does not put a current employer into a previous-employer field", () => {
    expect(map("Previous employer").value).toBeUndefined();
  });
  it("R09 does not let an upload suppress a neighboring name", () => {
    document.body.innerHTML = '<form>\n<label>First name<input></label>\n<label>Resume<input type="file"></label>\n</form>';
    fillPage(); expect(document.querySelector("input")!.value).toBe("Alex");
  });
  it("R10 separates radio labels from machine values", () => {
    document.body.innerHTML = '<fieldset><legend>Authorized to work in the US?</legend><label><input type="radio" name="auth" value="1">Yes</label><label><input type="radio" name="auth" value="0">No</label></fieldset>';
    expect(scanPage()[0].options).toEqual(["Yes", "No"]);
  });
  it("R10 fills the actual true/false option rather than a nonexistent Yes option", () => {
    document.body.innerHTML = '<label>Authorized to work in the United States?<select><option value="">Choose</option><option>true</option><option>false</option></select></label>';
    fillPage(); expect(document.querySelector("select")!.value).toBe("true");
  });
  it.each(["C++", "C#"])("R11 returns saved years for %s", (skill) => {
    const profile = { ...sampleProfile, experienceYears: { [skill]: 6 } };
    expect(mapField({ id: "x", labelText: `Years of ${skill} experience`, elementType: "input" }, profile).value).toBe("6");
  });
  it("R13 rejects invalid formats and contradictory dates", () => {
    const profile = structuredClone(sampleProfile); profile.personal.email = "invalid"; profile.personal.linkedin = "javascript:bad"; profile.education[0].end!.year = 2010; profile.experience[0].current = false;
    const validation = validateProfileDetailed(profile); expect(validation.valid).toBe(false); expect(validation.errors).toHaveLength(4);
  });
  it("R17 keeps standalone checkboxes separate", () => {
    document.body.innerHTML = '<form><label><input type="checkbox" checked>Newsletter</label><label><input type="checkbox" required>Accept terms</label></form>';
    const fields = scanPage(); expect(fields).toHaveLength(2); expect(fields[1]).toMatchObject({ required: true, valueBefore: "" });
  });
  it("R19 exports no private labels, nearby text, or values", () => {
    const json = JSON.stringify(debugFields([{ id: "x", elementType: "input", labelText: "secret label", nearbyText: "private note", valueBefore: "secret", name: "private name", options: ["private option"] }]));
    expect(json).not.toMatch(/secret|private/); expect(json).toContain('"optionCount":1');
  });
  it("R20 detects and fills native controls in open shadow roots", () => {
    const host = document.createElement("div"); document.body.append(host); const shadow = host.attachShadow({ mode: "open" }); shadow.innerHTML = '<label>First name<input></label>';
    fillPage(); expect(shadow.querySelector("input")!.value).toBe("Alex");
  });
  it("R20 detects and fills same-origin iframe controls", () => {
    const iframe = document.createElement("iframe"); document.body.append(iframe); iframe.contentDocument!.body.innerHTML = '<label>First name<input></label>';
    (iframe.contentWindow as unknown as typeof globalThis).Element.prototype.getBoundingClientRect = Element.prototype.getBoundingClientRect;
    fillPage(); expect(iframe.contentDocument!.querySelector("input")!.value).toBe("Alex");
  });
  it("R20 warns about custom widgets and does not type into their input", () => {
    document.body.innerHTML = '<label>Location<input role="combobox"></label>'; fillPage(); expect(getScanWarnings()).toHaveLength(1); expect(document.querySelector("input")!.value).toBe("");
  });
  it("R24 recognizes Name and Surname independently from repeated metadata", () => {
    expect(map("Name", { name: "name" }).value).toBe("Alex Example"); expect(map("Surname", { name: "surname" }).value).toBe("Example");
  });
});
