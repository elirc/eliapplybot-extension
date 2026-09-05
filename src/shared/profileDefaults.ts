import type { CandidateProfile } from "./types";
import { sampleProfile } from "./sampleProfile";
export const blankProfile: CandidateProfile = {
  personal: { firstName: "", lastName: "", email: "", phone: "", location: "", linkedin: "" },
  authorization: { legallyAuthorizedUS: false, requiresSponsorshipNowOrFuture: false },
  eeo: {}, education: [], experience: [], experienceYears: {}
};
export function isPlaceholder(profile: CandidateProfile): boolean {
  return profile.personal.email === sampleProfile.personal.email || profile.personal.phone === sampleProfile.personal.phone || profile.personal.linkedin === sampleProfile.personal.linkedin;
}
