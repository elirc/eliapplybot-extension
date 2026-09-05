import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { scanPage } from "./scanner";
import { mapFields } from "../shared/fieldMatchers";
import { sampleProfile } from "../shared/sampleProfile";
import { fillField, rollbackFilled, type RollbackEntry } from "./filler";

describe("React controlled fields", () => {
  it("updates text state on fill and rollback", async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>'; const root = createRoot(document.getElementById("root")!);
    function Form() { const [name, setName] = useState(""); return <><label>First name<input value={name} onChange={(e) => setName(e.target.value)} /></label><output>{name}</output></>; }
    await act(async () => root.render(<Form />));
    const fields = scanPage(); const entries: RollbackEntry[] = [];
    await act(async () => { expect(fillField(mapFields(fields, sampleProfile)[0], fields[0], entries)).toBe(true); });
    expect(document.querySelector("output")!.textContent).toBe("Alex");
    await act(async () => { rollbackFilled(entries); }); expect(document.querySelector("output")!.textContent).toBe("");
    await act(async () => root.unmount());
  });
  it("R23 leaves controlled radios for manual selection without diverging state", async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>'; const root = createRoot(document.getElementById("root")!);
    function Form() { const [value, setValue] = useState(""); return <><fieldset><legend>Authorized to work in the United States?</legend>{["Yes", "No"].map((v) => <label key={v}><input type="radio" name="auth" value={v} checked={value === v} onChange={() => setValue(v)} />{v}</label>)}</fieldset><output>{value}</output></>; }
    await act(async () => root.render(<Form />)); const fields = scanPage();
    const mapping = mapFields(fields, sampleProfile)[0]; expect(mapping.confidence).toBe("medium");
    expect(fillField(mapping, fields[0], [])).toBe(false); expect(document.querySelector("output")!.textContent).toBe(""); expect(document.querySelector("input")!.checked).toBe(false);
    await act(async () => root.unmount());
  });
});
