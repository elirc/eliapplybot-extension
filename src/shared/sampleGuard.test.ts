import { describe, expect, it } from "vitest";
import { sampleProfile } from "./sampleProfile";
import { isSampleProfile } from "./storage";
import type { CandidateProfile } from "./types";

function realProfile(): CandidateProfile {
  const profile = structuredClone(sampleProfile);
  profile.personal.firstName = "Eli";
  profile.personal.lastName = "Rosenthal";
  profile.personal.email = "eli@realmail.com";
  return profile;
}

describe("isSampleProfile", () => {
  it("recognizes the untouched sample profile", () => {
    expect(isSampleProfile(sampleProfile)).toBe(true);
  });

  it("still recognizes the sample when only the name was edited", () => {
    const profile = structuredClone(sampleProfile);
    profile.personal.firstName = "Eli";
    profile.personal.lastName = "Rosenthal";
    expect(isSampleProfile(profile)).toBe(true);
  });

  it("still recognizes the sample when only the email was edited", () => {
    const profile = structuredClone(sampleProfile);
    profile.personal.email = "eli@realmail.com";
    expect(isSampleProfile(profile)).toBe(true);
  });

  it("treats any @example.com address as placeholder data", () => {
    const profile = realProfile();
    profile.personal.email = "someone.else@example.com";
    expect(isSampleProfile(profile)).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    const profile = structuredClone(sampleProfile);
    profile.personal.email = `  ${sampleProfile.personal.email.toUpperCase()} `;
    expect(isSampleProfile(profile)).toBe(true);
  });

  it("returns false once name and email are real", () => {
    expect(isSampleProfile(realProfile())).toBe(false);
  });

  it("does not flag a real profile that happens to share the sample first name", () => {
    const profile = realProfile();
    profile.personal.firstName = sampleProfile.personal.firstName;
    expect(isSampleProfile(profile)).toBe(false);
  });

  it("does not throw on a malformed profile", () => {
    expect(isSampleProfile({} as CandidateProfile)).toBe(false);
  });
});
