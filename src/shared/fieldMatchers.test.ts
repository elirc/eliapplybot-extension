import { describe, expect, it } from "vitest";
import { isDeclineToAnswer, mapField, normalizeText } from "./fieldMatchers";
import { sampleProfile } from "./sampleProfile";
import type { CandidateProfile, DetectedField } from "./types";

// mapField refuses to fill any value the user never edited out of the sample, so
// these tests run against a profile whose distinctive fields hold real-looking
// data. The placeholder behavior itself is pinned in its own describe block below.
const testProfile: CandidateProfile = (() => {
  const profile = structuredClone(sampleProfile);
  profile.personal.firstName = "Dana";
  profile.personal.lastName = "Okonkwo";
  profile.personal.email = "dana.okonkwo@realmail.test";
  profile.personal.phone = "312-555-8890";
  profile.personal.location = "Chicago, IL";
  profile.personal.linkedin = "https://www.linkedin.com/in/dana-okonkwo";
  profile.personal.github = "https://github.com/dokonkwo";
  profile.personal.portfolio = "https://dana.works";
  profile.education[0].school = "Northwestern University";
  profile.experience[0].company = "Kestrel Analytics";
  return profile;
})();

function field(partial: Partial<DetectedField>): DetectedField {
  return {
    id: "field-1",
    elementType: "input",
    labelText: "",
    ...partial
  };
}

function profileWith(overrides: Partial<CandidateProfile>): CandidateProfile {
  return { ...structuredClone(testProfile), ...overrides };
}

describe("normalizeText", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeText("  First_Name / e-mail! ")).toBe("first name e mail");
    expect(normalizeText(undefined)).toBe("");
    expect(normalizeText("C# and Node.js")).toBe("c# and node js");
  });
});

describe("contact fields", () => {
  it("maps standardized contact fields with high confidence", () => {
    const mapping = mapField(field({ labelText: "First name", name: "first_name" }), testProfile);
    expect(mapping.kind).toBe("firstName");
    expect(mapping.confidence).toBe("high");
    expect(mapping.value).toBe(testProfile.personal.firstName);
  });

  it("maps full name, phone, and linkedin", () => {
    expect(mapField(field({ labelText: "Full name" }), testProfile).kind).toBe("fullName");
    expect(mapField(field({ labelText: "Phone number" }), testProfile).kind).toBe("phone");
    expect(mapField(field({ labelText: "LinkedIn profile" }), testProfile).kind).toBe("linkedin");
  });

  it("maps 'Email address' to email, never to location", () => {
    const mapping = mapField(field({ labelText: "Email address", name: "email" }), testProfile);
    expect(mapping.kind).toBe("email");
    expect(mapping.value).toBe(testProfile.personal.email);
  });

  it("still maps a Location field that sits near an email field", () => {
    const mapping = mapField(
      field({
        labelText: "Location",
        name: "location",
        placeholder: "City, State",
        nearbyText: "Email address Location Phone"
      }),
      testProfile
    );
    expect(mapping.kind).toBe("location");
    expect(mapping.confidence).toBe("high");
  });

  it("does not treat a bare 'Address' label as the personal location", () => {
    const mapping = mapField(field({ labelText: "Address" }), testProfile);
    expect(mapping.kind).not.toBe("location");
  });

  it("maps mailing address to location", () => {
    const mapping = mapField(field({ labelText: "Mailing address" }), testProfile);
    expect(mapping.kind).toBe("location");
  });

  it("does not map an employer address to the personal location", () => {
    const mapping = mapField(field({ labelText: "City", nearbyText: "Current employer address" }), testProfile);
    expect(mapping.kind).not.toBe("location");
  });
});

describe("skips", () => {
  it("skips resume uploads", () => {
    const mapping = mapField(field({ labelText: "Resume upload", inputType: "file" }), testProfile);
    expect(mapping.confidence).toBe("skip");
  });

  it("skips cover letter textareas", () => {
    const mapping = mapField(field({ elementType: "textarea", labelText: "Cover letter" }), testProfile);
    expect(mapping.confidence).toBe("skip");
  });

  it("skips job-specific essay questions", () => {
    const mapping = mapField(
      field({ elementType: "textarea", labelText: "Why do you want to join our company?" }),
      testProfile
    );
    expect(mapping.confidence).toBe("skip");
  });

  it("never touches buttons", () => {
    const mapping = mapField(field({ inputType: "submit", labelText: "Submit application" }), testProfile);
    expect(mapping.confidence).toBe("skip");
  });
});

describe("authorization", () => {
  it("fills clear sponsorship questions cautiously", () => {
    const mapping = mapField(
      field({
        elementType: "select",
        labelText: "Will you now or in the future require sponsorship?",
        options: ["", "Yes", "No"]
      }),
      testProfile
    );
    expect(mapping.kind).toBe("sponsorship");
    expect(mapping.confidence).toBe("high");
    expect(mapping.value).toBe("No");
  });

  it("downgrades bare text inputs to review-only instead of typing Yes", () => {
    const mapping = mapField(
      field({ labelText: "Are you legally authorized to work in the United States?" }),
      testProfile
    );
    expect(mapping.kind).toBe("workAuthorization");
    expect(mapping.confidence).toBe("medium");
    expect(mapping.value).toBeUndefined();
  });

  it("downgrades selects whose options are not a clear yes/no set", () => {
    const mapping = mapField(
      field({
        elementType: "select",
        labelText: "Are you authorized to work in the US?",
        options: ["Citizen", "Green card", "H1B"]
      }),
      testProfile
    );
    expect(mapping.confidence).toBe("medium");
  });
});

describe("EEO", () => {
  it("fills when the saved answer matches an option exactly", () => {
    const mapping = mapField(
      field({
        elementType: "select",
        labelText: "Gender",
        options: ["Man", "Woman", "I don't wish to answer"]
      }),
      testProfile
    );
    expect(mapping.kind).toBe("eeoGender");
    expect(mapping.confidence).toBe("high");
    expect(mapping.value).toBe("I don't wish to answer");
  });

  it("stays review-only when the saved answer is not among the options", () => {
    const mapping = mapField(
      field({ elementType: "select", labelText: "Gender", options: ["Male", "Female"] }),
      testProfile
    );
    expect(mapping.kind).toBe("eeoGender");
    expect(mapping.confidence).toBe("medium");
  });
});

describe("EEO decline-to-answer cluster", () => {
  const declinePhrasings = [
    "Decline To Self Identify", // Greenhouse
    "Decline to self-identify", // Lever
    "I don't wish to answer", // Workday / Greenhouse
    "I do not wish to answer",
    "Prefer not to say",
    "I prefer not to answer",
    "Choose not to disclose",
    "I don't want to answer",
    "Do not wish to disclose",
    "I'd rather not say",
    "Decline"
  ];

  it.each(declinePhrasings)("fills the site's own wording: %s", (option) => {
    const mapping = mapField(
      field({ elementType: "select", labelText: "Gender", options: ["", "Man", "Woman", option] }),
      testProfile
    );
    expect(mapping.kind).toBe("eeoGender");
    expect(mapping.confidence).toBe("high");
    // Only ever an option the control actually offers — never invented text.
    expect(mapping.value).toBe(option);
  });

  it.each(declinePhrasings)("recognizes %s as a decline value", (phrase) => {
    expect(isDeclineToAnswer(phrase)).toBe(true);
  });

  it("works for race, veteran, and disability fields too", () => {
    const race = mapField(
      field({
        elementType: "select",
        labelText: "Race / Ethnicity",
        options: ["White", "Two or More Races", "Decline To Self Identify"]
      }),
      testProfile
    );
    expect(race.kind).toBe("eeoRace");
    expect(race.confidence).toBe("high");
    expect(race.value).toBe("Decline To Self Identify");

    const veteran = mapField(
      field({
        elementType: "select",
        labelText: "Protected veteran status",
        options: [
          "I identify as one or more of the classifications of a protected veteran",
          "I am not a protected veteran",
          "I don't wish to answer"
        ]
      }),
      testProfile
    );
    expect(veteran.kind).toBe("eeoVeteran");
    expect(veteran.confidence).toBe("high");
    expect(veteran.value).toBe("I don't wish to answer");

    const disability = mapField(
      field({
        elementType: "select",
        labelText: "Disability status",
        options: [
          "Yes, I have a disability, or have had one in the past",
          "No, I do not have a disability and have not had one in the past",
          "I do not want to answer"
        ]
      }),
      testProfile
    );
    expect(disability.kind).toBe("eeoDisability");
    expect(disability.confidence).toBe("high");
    expect(disability.value).toBe("I do not want to answer");
  });

  it("prefers an exact option match over a cluster match", () => {
    const mapping = mapField(
      field({
        elementType: "select",
        labelText: "Gender",
        options: ["Man", "Woman", "Decline to self-identify", "I don't wish to answer"]
      }),
      testProfile
    );
    expect(mapping.confidence).toBe("high");
    expect(mapping.value).toBe("I don't wish to answer");
  });

  it("falls back to review-only when several options look like a decline", () => {
    const mapping = mapField(
      field({
        elementType: "select",
        labelText: "Gender",
        options: ["Man", "Woman", "Prefer not to say", "Decline to self-identify"]
      }),
      profileWith({ eeo: { gender: "Prefer not to answer" } })
    );
    expect(mapping.kind).toBe("eeoGender");
    expect(mapping.confidence).toBe("medium");
    expect(mapping.value).toBeUndefined();
  });

  it("treats two spellings of the same option as one, not as ambiguity", () => {
    const mapping = mapField(
      field({
        elementType: "select",
        labelText: "Gender",
        options: ["Man", "Woman", "Decline To Self Identify", "decline to self-identify"]
      }),
      testProfile
    );
    expect(mapping.confidence).toBe("high");
    expect(mapping.value).toBe("Decline To Self Identify");
  });

  it("never cluster-matches a real self-identification answer", () => {
    const mapping = mapField(
      field({
        elementType: "select",
        labelText: "Gender",
        options: ["Man", "Woman", "Non-binary", "Decline To Self Identify"]
      }),
      profileWith({ eeo: { gender: "Male" } })
    );
    expect(mapping.kind).toBe("eeoGender");
    expect(mapping.confidence).toBe("medium");
    expect(mapping.value).toBeUndefined();
  });

  it("does not read real answers as declines", () => {
    const realAnswers = [
      "Male",
      "Female",
      "Non-binary",
      "Prefer to self-describe",
      "I wish to disclose my status",
      "Two or More Races",
      "White (Not Hispanic or Latino)",
      "I identify as one or more of the classifications of a protected veteran",
      "I am not a protected veteran",
      "Yes, I have a disability, or have had one in the past",
      "No, I do not have a disability and have not had one in the past",
      "I do not have a disability",
      ""
    ];
    for (const answer of realAnswers) {
      expect(isDeclineToAnswer(answer)).toBe(false);
    }
  });

  it("stays review-only when no option belongs to the cluster", () => {
    const mapping = mapField(
      field({ elementType: "select", labelText: "Gender", options: ["Man", "Woman", "Non-binary"] }),
      testProfile
    );
    expect(mapping.kind).toBe("eeoGender");
    expect(mapping.confidence).toBe("medium");
    expect(mapping.value).toBeUndefined();
  });

  it("only ever fills a string that exists in the field's options", () => {
    const options = ["", "Man", "Woman", "I prefer not to disclose"];
    const mapping = mapField(field({ elementType: "select", labelText: "Gender", options }), testProfile);
    expect(mapping.confidence).toBe("high");
    expect(options).toContain(mapping.value);
  });
});

describe("years of experience", () => {
  it("does not fill without an exact skill match", () => {
    const mapping = mapField(field({ labelText: "Years of Kubernetes experience" }), testProfile);
    expect(mapping.kind).toBe("yearsOfExperience");
    expect(mapping.confidence).toBe("medium");
    expect(mapping.value).toBeUndefined();
  });

  it("does not let 'java' match 'JavaScript'", () => {
    const profile = profileWith({ experienceYears: { java: 8, javascript: 5 } });
    const js = mapField(field({ labelText: "Years of JavaScript experience" }), profile);
    expect(js.confidence).toBe("high");
    expect(js.value).toBe("5");

    const java = mapField(field({ labelText: "Years of Java experience" }), profile);
    expect(java.value).toBe("8");
  });

  it("prefers the longest matching skill", () => {
    const profile = profileWith({ experienceYears: { js: 2, "node.js": 3 } });
    const mapping = mapField(field({ labelText: "Years of Node.js experience" }), profile);
    expect(mapping.value).toBe("3");
  });

  it("matches skills containing regex metacharacters", () => {
    const profile = profileWith({ experienceYears: { "c++": 6 } });
    const mapping = mapField(field({ labelText: "Years of C++ experience" }), profile);
    // normalizeText strips "+" from the page text as well, so both sides align.
    expect(mapping.kind).toBe("yearsOfExperience");
  });
});

describe("education and experience", () => {
  it("maps school and degree", () => {
    const school = mapField(field({ labelText: "School or university" }), testProfile);
    expect(school.kind).toBe("educationSchool");
    expect(school.value).toBe(testProfile.education[0].school);

    const degree = mapField(field({ labelText: "Degree", nearbyText: "Education" }), testProfile);
    expect(degree.kind).toBe("educationDegree");
  });

  it("maps company and title", () => {
    const company = mapField(field({ labelText: "Employer company" }), testProfile);
    expect(company.kind).toBe("experienceCompany");
    expect(company.value).toBe(testProfile.experience[0].company);

    const title = mapField(field({ labelText: "Position title", nearbyText: "Work experience" }), testProfile);
    expect(title.kind).toBe("experienceTitle");
  });

  it("formats a current role's end date as Present", () => {
    const mapping = mapField(
      field({ labelText: "Experience end date", nearbyText: "Employment history" }),
      testProfile
    );
    expect(mapping.kind).toBe("experienceEndDate");
    expect(mapping.value).toBe("Present");
  });

  it("returns low-confidence unknown when nothing matches", () => {
    const mapping = mapField(field({ labelText: "Favorite color" }), testProfile);
    expect(mapping.kind).toBe("unknown");
    expect(mapping.confidence).toBe("low");
  });
});

describe("placeholder guard", () => {
  // The storage-level guard only blocks an untouched *identity*. A user who fixes
  // their name and email and starts applying would otherwise submit the sample's
  // phone, LinkedIn, school and employer into a real application.
  const halfEdited = (): CandidateProfile => {
    const profile = structuredClone(sampleProfile);
    profile.personal.firstName = "Dana";
    profile.personal.lastName = "Okonkwo";
    profile.personal.email = "dana.okonkwo@realmail.test";
    return profile;
  };

  it.each([
    ["Phone number", "phone"],
    ["LinkedIn profile", "linkedin"],
    ["GitHub", "github"],
    ["Personal website", "portfolio"]
  ])("refuses to fill the untouched sample %s", (labelText, kind) => {
    const mapping = mapField(field({ labelText }), halfEdited());
    expect(mapping.kind).toBe(kind);
    expect(mapping.confidence).toBe("medium");
    expect(mapping.value).toBeUndefined();
    expect(mapping.reason).toMatch(/placeholder/i);
  });

  it("refuses the untouched sample school and employer", () => {
    const school = mapField(field({ labelText: "School", nearbyText: "Education" }), halfEdited());
    expect(school.confidence).toBe("medium");
    expect(school.value).toBeUndefined();

    const company = mapField(field({ labelText: "Employer company" }), halfEdited());
    expect(company.confidence).toBe("medium");
    expect(company.value).toBeUndefined();
  });

  it("fills the fields the user did edit", () => {
    const email = mapField(field({ labelText: "Email address" }), halfEdited());
    expect(email.confidence).toBe("high");
    expect(email.value).toBe("dana.okonkwo@realmail.test");
  });

  it("still fills a real value that happens to match a non-distinctive sample field", () => {
    // "Bachelor of Science" and "Computer Science" are things a real profile
    // legitimately contains, so they are deliberately not treated as placeholders.
    const profile = halfEdited();
    const degree = mapField(field({ labelText: "Degree", nearbyText: "Education" }), profile);
    expect(degree.confidence).toBe("high");
    expect(degree.value).toBe(sampleProfile.education[0].degree);
  });

  it("does not treat a kept EEO decline answer as a placeholder", () => {
    // "I don't wish to answer" is the sample's value but also a real choice.
    const options = ["Male", "Female", "I don't wish to answer"];
    const mapping = mapField(field({ elementType: "select", labelText: "Gender", options }), halfEdited());
    expect(mapping.confidence).toBe("high");
    expect(mapping.value).toBe("I don't wish to answer");
  });

  it("does not block a fully real profile", () => {
    const mapping = mapField(field({ labelText: "Phone number" }), testProfile);
    expect(mapping.confidence).toBe("high");
    expect(mapping.value).toBe("312-555-8890");
  });
});

describe("yes/no comboboxes with hidden options", () => {
  // Greenhouse renders these as react-select; the options only exist while the
  // menu is open, and Detect must not open menus.
  it("trusts an unopened combobox for an authorization question", () => {
    const mapping = mapField(
      field({
        elementType: "combobox",
        labelText: "Are you legally authorized to work in the United States?",
        options: undefined
      }),
      testProfile
    );
    expect(mapping.kind).toBe("workAuthorization");
    expect(mapping.confidence).toBe("high");
    expect(mapping.value).toBe("Yes");
  });

  it("trusts an unopened combobox for a sponsorship question", () => {
    const mapping = mapField(
      field({
        elementType: "combobox",
        labelText: "Will you now or in the future require sponsorship?",
        options: undefined
      }),
      testProfile
    );
    expect(mapping.kind).toBe("sponsorship");
    expect(mapping.value).toBe("No");
  });

  it("still requires a real yes/no pair once the options are known", () => {
    const mapping = mapField(
      field({
        elementType: "combobox",
        labelText: "Are you legally authorized to work in the United States?",
        options: ["Citizen", "Green card", "H1B"]
      }),
      testProfile
    );
    expect(mapping.confidence).toBe("medium");
    expect(mapping.value).toBeUndefined();
  });

  it("never types a bare Yes into a free-text input", () => {
    const mapping = mapField(
      field({ elementType: "input", labelText: "Are you legally authorized to work in the United States?" }),
      testProfile
    );
    expect(mapping.confidence).toBe("medium");
    expect(mapping.value).toBeUndefined();
  });

  it("still requires the question in the field's own label", () => {
    const mapping = mapField(
      field({
        elementType: "combobox",
        labelText: "Country",
        nearbyText: "Are you legally authorized to work in the United States?",
        options: undefined
      }),
      testProfile
    );
    expect(mapping.confidence).not.toBe("high");
  });
});
