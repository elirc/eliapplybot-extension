import { beforeEach, describe, expect, it } from "vitest";
import { findFieldElements, findFieldNodes, scanPage } from "./scanner";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("scanPage", () => {
  it("detects labeled inputs with names and placeholders", () => {
    document.body.innerHTML = `
      <label>First name <input name="first_name" placeholder="Given name" required /></label>`;
    const fields = scanPage();
    expect(fields).toHaveLength(1);
    expect(fields[0].labelText).toContain("First name");
    expect(fields[0].name).toBe("first_name");
    expect(fields[0].placeholder).toBe("Given name");
    expect(fields[0].required).toBe(true);
  });

  it("groups radios sharing a name into one field with option labels", () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>Authorized to work?</legend>
        <label><input type="radio" name="auth" value="yes" /> Yes</label>
        <label><input type="radio" name="auth" value="no" /> No</label>
      </fieldset>`;
    const fields = scanPage();
    expect(fields).toHaveLength(1);
    expect(fields[0].elementType).toBe("radio");
    expect(fields[0].options).toHaveLength(2);
    expect(findFieldElements(fields[0].id)).toHaveLength(2);
  });

  it("keeps unnamed radio groups in separate containers apart", () => {
    document.body.innerHTML = `
      <div><div>
        <label><input type="radio" value="yes" /> Yes</label>
        <label><input type="radio" value="no" /> No</label>
      </div></div>
      <div><div>
        <label><input type="radio" value="remote" /> Remote</label>
        <label><input type="radio" value="onsite" /> Onsite</label>
      </div></div>`;
    const fields = scanPage().filter((field) => field.elementType === "radio");
    expect(fields).toHaveLength(2);
    expect(fields[0].options).toHaveLength(2);
    expect(fields[1].options).toHaveLength(2);
  });

  it("skips hidden inputs", () => {
    document.body.innerHTML = `
      <input type="hidden" name="csrf" />
      <input name="visible_one" />
      <input name="styled_away" style="display: none" />`;
    const fields = scanPage();
    expect(fields).toHaveLength(1);
    expect(fields[0].name).toBe("visible_one");
  });

  it("captures select options", () => {
    document.body.innerHTML = `
      <label>Gender
        <select name="gender">
          <option value="">Select one</option>
          <option>Man</option>
          <option>Woman</option>
        </select>
      </label>`;
    const fields = scanPage();
    expect(fields[0].elementType).toBe("select");
    expect(fields[0].options).toEqual(["Select one", "Man", "Woman"]);
  });

  it("reads combobox options from a menu the page already has open", () => {
    document.body.innerHTML = `
      <label id="gender-label" for="gender">Gender</label>
      <div class="select__control">
        <input id="gender" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-labelledby="gender-label" />
      </div>
      <div id="react-select-gender-listbox" role="listbox">
        <div role="option">Man</div>
        <div role="option">Woman</div>
      </div>`;

    const fields = scanPage();
    expect(fields).toHaveLength(1);
    expect(fields[0].elementType).toBe("combobox");
    expect(fields[0].options).toEqual(["Man", "Woman"]);
  });

  it("reads combobox options from a datalist without opening anything", () => {
    document.body.innerHTML = `
      <label for="country">Country</label>
      <input id="country" role="combobox" list="country-options" aria-autocomplete="list" />
      <datalist id="country-options">
        <option value="Canada"></option>
        <option value="United States"></option>
      </datalist>`;

    const fields = scanPage();
    const combobox = fields.find((field) => field.elementType === "combobox")!;
    expect(combobox.options).toEqual(["Canada", "United States"]);
  });

  it("detects a non-input combobox and keeps it addressable", () => {
    document.body.innerHTML = `
      <div class="field">
        <span id="school-label">School</span>
        <div id="school" role="combobox" aria-labelledby="school-label" aria-expanded="false"></div>
      </div>`;

    const fields = scanPage();
    expect(fields).toHaveLength(1);
    expect(fields[0].elementType).toBe("combobox");
    expect(fields[0].labelText).toBe("School");
    expect(fields[0].options).toBeUndefined();
    expect(findFieldNodes(fields[0].id)).toHaveLength(1);
    // A div is not a form control, so the input-only accessor must not see it.
    expect(findFieldElements(fields[0].id)).toHaveLength(0);
  });
});

describe("rescanning", () => {
  it("clears field ids from a previous scan so a stale node cannot be filled", () => {
    document.body.innerHTML = `
      <label for="a">Email</label><input id="a" name="email" />
      <label for="b">Phone</label><input id="b" name="phone" />`;
    scanPage();
    const stale = document.getElementById("b")!;
    const staleId = stale.getAttribute("data-eli-apply-mate-field-id");
    expect(staleId).toBeTruthy();

    // The second field disappears from view between scans, as it would on a
    // re-rendering SPA. Ids restart at zero, so without cleanup the leftover
    // stamp collides with a freshly assigned one and the fill targets the
    // wrong node while still reporting success.
    stale.remove();
    document.body.append(stale);
    stale.style.display = "none";
    scanPage();

    expect(stale.getAttribute("data-eli-apply-mate-field-id")).toBeNull();
    expect(findFieldElements(staleId!)).not.toContain(stale);
  });
});
