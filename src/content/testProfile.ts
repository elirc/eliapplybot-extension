import { sampleProfile } from "../shared/sampleProfile";
import type { CandidateProfile } from "../shared/types";

/**
 * A profile that looks like a real user's rather than the shipped sample.
 *
 * `mapField` deliberately demotes any value still equal to one of the sample
 * profile's placeholders (email, phone, location, surname, school, employer) to
 * review-only, so filling tests have to use edited details — otherwise they
 * would be asserting on values the extension is designed *not* to fill.
 */
export const filledProfile: CandidateProfile = {
  ...sampleProfile,
  personal: {
    firstName: "Dana",
    lastName: "Ruiz",
    email: "dana.ruiz@mailbox.test",
    phone: "555-222-0000",
    location: "Austin, TX",
    linkedin: "https://www.linkedin.com/in/dana-ruiz",
    github: "https://github.com/dana-ruiz",
    portfolio: "https://dana-ruiz.test"
  },
  education: sampleProfile.education.map((entry, index) =>
    index === 0 ? { ...entry, school: "Northwood University" } : entry
  ),
  experience: sampleProfile.experience.map((entry, index) =>
    index === 0 ? { ...entry, company: "Vector Labs" } : entry
  )
};
