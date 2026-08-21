import { sampleProfile } from "./sampleProfile";
import type { CandidateProfile, DetectedField, FieldKind, FieldMapping } from "./types";

type MatchCandidate = Pick<FieldMapping, "kind" | "confidence" | "reason" | "value">;

type MatchContext = {
  field: DetectedField;
  /** Everything near the field, including sibling labels — good for section context only. */
  text: string;
  /** The field's own label, name, id, and placeholder — required for high-confidence matches. */
  own: string;
  profile: CandidateProfile;
};

const SKIP_PATTERNS = [
  /\bresume\b/i,
  /\bcv\b/i,
  /\bcover letter\b/i,
  /\bwriting sample\b/i,
  /\bportfolio upload\b/i,
  /\battachment\b/i,
  /\bfile upload\b/i
];

const SHORT_ANSWER_PATTERNS = [
  /\bwhy\b.*\b(company|role|team|us)\b/i,
  /\btell us\b/i,
  /\bdescribe\b/i,
  /\bstory\b/i,
  /\bproject\b/i,
  /\bessay\b/i,
  /\bcover letter\b/i
];

const YES_VALUES = ["yes", "y", "true"];
const NO_VALUES = ["no", "n", "false"];

// The one synonym cluster this version trusts: every phrasing below means "I
// would rather not answer this EEO question". ATS vendors word it differently
// (Greenhouse "Decline To Self Identify", Lever "Decline to self-identify",
// Workday "I don't wish to answer", others "Prefer not to say"), so a saved
// decline value is matched against whatever wording the site actually offers.
//
// Deliberately narrow: real self-identification answers (a gender, a race, a
// veteran or disability status) are never cluster-matched. Making the user pick
// one of those by hand is far better than filling in the wrong one.
const DECLINE_TARGET = "(?:self\\s+identify|identif(?:y|ication)|answer|respond|reply|say|state|disclose|specify|provide|share)";
const DECLINE_PATTERNS = [
  // "Decline to self identify", "Declines to answer", "Decline to state".
  new RegExp(`\\bdeclines?\\s+(?:to\\s+)?${DECLINE_TARGET}\\b`),
  // "Prefer not to say", "I prefer not to disclose".
  new RegExp(`\\bprefers?\\s+not\\s+to\\s+${DECLINE_TARGET}\\b`),
  // "I do not wish to answer", "I don't want to answer" (normalizeText turns
  // "don't" into "don t"), "Do not wish to disclose".
  new RegExp(`\\b(?:do|does|did)(?:\\s+not|n\\s+t)\\s+(?:wish|want|care|choose|prefer)\\s+(?:to\\s+)?${DECLINE_TARGET}\\b`),
  // "Choose not to disclose", "Wish not to answer", "Opt not to identify".
  new RegExp(`\\b(?:wish|choose|chose|opt|elect)e?s?\\s+not\\s+to\\s+${DECLINE_TARGET}\\b`),
  // "I'd rather not say".
  new RegExp(`\\brather\\s+not\\s+(?:to\\s+)?${DECLINE_TARGET}\\b`),
  // Bare "Decline" / "Declined", used on its own by a few boards.
  /^declined?$/
];

export function normalizeText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[_\-./]+/g, " ")
    .replace(/[^a-z0-9+# ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function mapFields(fields: DetectedField[], profile: CandidateProfile): FieldMapping[] {
  return fields.map((field) => mapField(field, profile));
}

export function mapField(field: DetectedField, profile: CandidateProfile): FieldMapping {
  const text = buildFieldText(field);
  const context: MatchContext = { field, text, own: buildOwnText(field), profile };
  const base = {
    fieldId: field.id,
    labelText: field.labelText
  };

  if (field.inputType === "submit" || field.inputType === "button" || field.inputType === "reset") {
    return { ...base, kind: "unknown", confidence: "skip", reason: "Button controls are never clicked or filled." };
  }

  if (field.inputType === "file" || SKIP_PATTERNS.some((pattern) => pattern.test(text))) {
    return { ...base, kind: "unknown", confidence: "skip", reason: "File uploads, resumes, and cover letters are skipped in v1." };
  }

  if (field.elementType === "textarea" && SHORT_ANSWER_PATTERNS.some((pattern) => pattern.test(text))) {
    return { ...base, kind: "unknown", confidence: "skip", reason: "Job-specific long-form answers are intentionally skipped." };
  }

  const candidate =
    matchPersonal(context) ??
    matchAuthorization(context) ??
    matchEeo(context) ??
    matchExperienceYears(context) ??
    matchEducation(context) ??
    matchExperience(context);

  if (candidate) return { ...base, ...guardPlaceholder(candidate) };

  return { ...base, kind: "unknown", confidence: "low", reason: "No deterministic v1 mapping matched this field." };
}

// Kinds whose value is an intent rather than personal data. A kept EEO answer of
// "I don't wish to answer" is a real choice, and a Yes/No authorization answer
// carries no identity, so neither is ever treated as leftover placeholder text.
const PLACEHOLDER_EXEMPT_KINDS = new Set<FieldKind>([
  "eeoGender",
  "eeoRace",
  "eeoVeteran",
  "eeoDisability",
  "workAuthorization",
  "sponsorship"
]);

/**
 * Refuses to fill a value the user never edited out of the sample profile.
 *
 * The all-or-nothing guard in storage.ts only recognizes an untouched *identity*.
 * The realistic case it misses is a user who fixes their name and email, starts
 * applying, and silently submits the placeholder phone number, LinkedIn, school
 * and employer that are still sitting in the profile — worse than the fully-fake
 * case, because editing the profile gives them every reason to trust it. So each
 * value is checked individually here and demoted to review-only, which leaves the
 * user free to apply as soon as the fields they care about are real.
 */
function guardPlaceholder(candidate: MatchCandidate): MatchCandidate {
  if (candidate.confidence !== "high" || !candidate.value) return candidate;
  if (PLACEHOLDER_EXEMPT_KINDS.has(candidate.kind)) return candidate;
  if (!isPlaceholderValue(candidate.value)) return candidate;

  return {
    kind: candidate.kind,
    confidence: "medium",
    reason: "This is still the sample profile's placeholder value. Put your real details in the profile, then run autofill again."
  };
}

/**
 * Sample values distinctive enough that seeing one means "never edited".
 *
 * Deliberately partial: "Bachelor of Science", "Computer Science", "Frontend
 * Engineer", "Remote" and the sample dates are all things a real profile might
 * legitimately contain, so matching them would demote correct data. "Alex" is
 * omitted for the same reason, while the surname "Example" and the full pair are
 * safe to claim.
 */
let placeholderValues: Set<string> | null = null;

function isPlaceholderValue(value: string): boolean {
  if (!placeholderValues) {
    const { personal, education, experience } = sampleProfile;
    placeholderValues = new Set(
      [
        personal.email,
        personal.phone,
        personal.location,
        personal.linkedin,
        personal.github,
        personal.portfolio,
        personal.lastName,
        `${personal.firstName} ${personal.lastName}`,
        education[0]?.school,
        experience[0]?.company
      ]
        .map((entry) => normalizeText(entry))
        .filter(Boolean)
    );
  }

  return placeholderValues.has(normalizeText(value));
}

function buildFieldText(field: DetectedField): string {
  return normalizeText(
    [
      field.labelText,
      field.nearbyText,
      field.sectionText,
      field.name,
      field.idAttribute,
      field.placeholder,
      ...(field.options ?? [])
    ].join(" ")
  );
}

function buildOwnText(field: DetectedField): string {
  return normalizeText([field.labelText, field.name, field.idAttribute, field.placeholder].join(" "));
}

function matchPersonal({ own: label, text, profile }: MatchContext): MatchCandidate | null {
  const personal = profile.personal;

  if (/\b(first|given)\s*name\b/.test(label)) {
    return high("firstName", personal.firstName, "Matched first/given name label.");
  }
  if (/\b(last|family|surname)\s*name\b/.test(label)) {
    return high("lastName", personal.lastName, "Matched last/family name label.");
  }
  if (/^name$|^\*?\s*name\s*\*?$|\bfull name\b/.test(label)) {
    return high("fullName", `${personal.firstName} ${personal.lastName}`, "Matched full name label.");
  }
  if (/\b(e mail|email|email address)\b/.test(label)) {
    return high("email", personal.email, "Matched email label.");
  }
  if (/\b(phone|mobile|telephone)\b/.test(label)) {
    return high("phone", personal.phone, "Matched phone label.");
  }
  if (/\b(linkedin|linked in)\b/.test(label)) {
    return high("linkedin", personal.linkedin, "Matched LinkedIn label.");
  }
  if (/\b(github|git hub)\b/.test(label) && personal.github) {
    return high("github", personal.github, "Matched GitHub label.");
  }
  if (/\b(portfolio|personal website|website|web site)\b/.test(label) && personal.portfolio) {
    return high("portfolio", personal.portfolio, "Matched portfolio or website label.");
  }
  // "address" alone is too broad (email address, employer address); require a
  // residence-flavored qualifier and exclude email labels and company contexts.
  const looksLikeLocation =
    /\b(location|city)\b/.test(label) || /\b(street|home|mailing|current|residential)\s+address\b/.test(label);
  if (looksLikeLocation && !/\b(e mail|email)\b/.test(label) && !/\b(company|employer)\b/.test(text)) {
    return high("location", personal.location, "Matched location/address label.");
  }

  return null;
}

function matchAuthorization({ field, own, text, profile }: MatchContext): MatchCandidate | null {
  const hasClearYesNo = hasRecognizedYesNo(field);
  const authorizationPattern = /\b(legally authorized|authorized to work|eligible to work)\b/;
  const sponsorshipPattern = /\b(sponsorship|visa sponsorship|work visa)\b/;

  // High confidence needs the question in the field's own label; matching on
  // nearby text alone would grab neighboring questions in the same section.
  if (authorizationPattern.test(own)) {
    if (!hasClearYesNo) {
      return medium("workAuthorization", "Authorization field found, but options are not a clear yes/no set.");
    }
    return high(
      "workAuthorization",
      profile.authorization.legallyAuthorizedUS ? "Yes" : "No",
      "Matched a clear work authorization yes/no question."
    );
  }

  if (sponsorshipPattern.test(own) && /\b(require|need|now|future)\b/.test(own)) {
    if (!hasClearYesNo) {
      return medium("sponsorship", "Sponsorship field found, but options are not a clear yes/no set.");
    }
    return high(
      "sponsorship",
      profile.authorization.requiresSponsorshipNowOrFuture ? "Yes" : "No",
      "Matched a clear sponsorship yes/no question."
    );
  }

  if (authorizationPattern.test(text)) {
    return medium("workAuthorization", "Authorization question found nearby, but not in this field's own label.");
  }
  if (sponsorshipPattern.test(text) && /\b(require|need|now|future)\b/.test(text)) {
    return medium("sponsorship", "Sponsorship question found nearby, but not in this field's own label.");
  }

  return null;
}

function matchEeo({ field, own, profile }: MatchContext): MatchCandidate | null {
  if (!field.options || field.options.length === 0) return null;

  const eeoChecks: Array<[RegExp, FieldKind, string | undefined, string]> = [
    [/\bgender\b/, "eeoGender", profile.eeo.gender, "Matched EEO gender field with a saved option."],
    [/\b(race|ethnicity|hispanic|latino)\b/, "eeoRace", profile.eeo.raceEthnicity, "Matched EEO race/ethnicity field with a saved option."],
    [/\b(veteran|protected veteran)\b/, "eeoVeteran", profile.eeo.veteranStatus, "Matched EEO veteran field with a saved option."],
    [/\b(disability|disabled)\b/, "eeoDisability", profile.eeo.disabilityStatus, "Matched EEO disability field with a saved option."]
  ];

  // EEO fields sit side by side on the same form, so only the field's own
  // label is trustworthy — nearby text would match every sibling question.
  for (const [pattern, kind, value, reason] of eeoChecks) {
    if (!pattern.test(own)) continue;

    if (value) {
      // An exact option always wins; cluster matching is only a fallback.
      const exact = findExactOption(field, value);
      if (exact !== null) return high(kind, exact, reason);

      if (isDeclineToAnswer(value)) {
        const declineOptions = findDeclineOptions(field);
        if (declineOptions.length === 1) {
          return high(
            kind,
            declineOptions[0],
            `Saved EEO value means "decline to answer"; filled this field's equivalent option "${declineOptions[0]}".`
          );
        }
        if (declineOptions.length > 1) {
          return medium(
            kind,
            `More than one option looks like "decline to answer" for ${kind}, so the choice is left to you.`
          );
        }
      }
    }

    return medium(kind, `Saved EEO value does not clearly match available options for ${kind}.`);
  }

  return null;
}

/** True when a value is one of the many ways ATS forms say "I'd rather not answer". */
export function isDeclineToAnswer(value: string | undefined): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return false;
  return DECLINE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function matchExperienceYears({ own, profile }: MatchContext): MatchCandidate | null {
  // The question must be in the field's own label; gating on nearby text would
  // let one "Years of X" question capture every field in the same section.
  if (!/\b(years?|yrs?)\b/.test(own) || !/\b(experience|exp)\b/.test(own)) return null;

  // Whole-word matches only ("java" must not match "javascript"); when several
  // saved skills match, the longest one wins so "node.js" beats "js".
  let best: { skill: string; years: number } | null = null;
  for (const [skill, years] of Object.entries(profile.experienceYears)) {
    const normalizedSkill = normalizeText(skill);
    if (!normalizedSkill) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(normalizedSkill)}\\b`);
    if (pattern.test(own) && (!best || normalizedSkill.length > normalizeText(best.skill).length)) {
      best = { skill, years };
    }
  }

  if (best) {
    return high("yearsOfExperience", String(best.years), `Matched exact saved years of experience skill: ${best.skill}.`);
  }

  return medium("yearsOfExperience", "Years-of-experience field found, but no exact saved skill matched.");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchEducation({ own, text, profile }: MatchContext): MatchCandidate | null {
  const education = profile.education[0];
  if (!education) return null;
  // Section context may come from nearby text, but the specific column must be
  // named in the field's own label so sibling fields don't cross-match.
  const inEducation = /\b(education|school|university|college|degree|study)\b/.test(text);
  if (!inEducation) return null;

  if (/\b(school|university|college|institution)\b/.test(own)) {
    return high("educationSchool", education.school, "Matched education school field.");
  }
  if (/\b(degree|qualification)\b/.test(own)) {
    return high("educationDegree", education.degree, "Matched education degree field.");
  }
  if (/\b(field of study|major|discipline)\b/.test(own) && education.fieldOfStudy) {
    return high("educationFieldOfStudy", education.fieldOfStudy, "Matched education field of study.");
  }
  if (/\b(start|from)\b/.test(own) && /\b(date|month|year)\b/.test(own)) {
    return high("educationStartDate", formatDate(education.start), "Matched education start date.");
  }
  if (/\b(end|to|graduation|graduate)\b/.test(own) && /\b(date|month|year)\b/.test(own)) {
    return high("educationEndDate", education.end ? formatDate(education.end) : "", "Matched education end date.");
  }

  return null;
}

function matchExperience({ own, text, profile }: MatchContext): MatchCandidate | null {
  const experience = profile.experience[0];
  if (!experience) return null;
  const inExperience = /\b(experience|employment|employer|company|job|work history|position)\b/.test(text);
  if (!inExperience) return null;

  if (/\b(company|employer|organization)\b/.test(own)) {
    return high("experienceCompany", experience.company, "Matched work experience company field.");
  }
  if (/\b(title|position|role)\b/.test(own)) {
    return high("experienceTitle", experience.title, "Matched work experience title field.");
  }
  if (/\b(location|city)\b/.test(own) && experience.location) {
    return high("experienceLocation", experience.location, "Matched work experience location field.");
  }
  if (/\b(start|from)\b/.test(own) && /\b(date|month|year)\b/.test(own)) {
    return high("experienceStartDate", formatDate(experience.start), "Matched work experience start date.");
  }
  if (/\b(end|to)\b/.test(own) && /\b(date|month|year)\b/.test(own)) {
    return high("experienceEndDate", experience.current ? "Present" : formatDate(experience.end), "Matched work experience end date.");
  }

  return null;
}

function high(kind: FieldKind, value: string | undefined, reason: string): MatchCandidate {
  return { kind, confidence: "high", value, reason };
}

function medium(kind: FieldKind, reason: string): MatchCandidate {
  return { kind, confidence: "medium", reason };
}

function formatDate(date: { month: number; year: number } | null): string {
  if (!date) return "";
  return `${String(date.month).padStart(2, "0")}/${date.year}`;
}

function hasRecognizedYesNo(field: DetectedField): boolean {
  // Greenhouse renders work-authorization and sponsorship questions as ARIA
  // comboboxes whose options exist in the DOM only while the menu is open, and
  // Detect must never open menus. Reporting "no options" here would leave every
  // Greenhouse authorization question unfillable. Trusting the control type moves
  // the decision to fill time, where the driver clicks only an option whose text
  // is exactly the target and otherwise refuses — a stricter check than this one.
  // Deliberately not extended to input/textarea: typing a bare "Yes" into a free
  // text box is the exact risk this function exists to prevent.
  if (field.elementType === "combobox" && field.options === undefined) return true;

  // Typing a literal "Yes"/"No" into a free-text control is risky, so bare
  // inputs and textareas are never treated as a clear yes/no set; they fall
  // back to medium (review-only) in the callers.
  if (!field.options || field.options.length === 0) return false;

  const normalizedOptions = field.options.map(normalizeText).filter(Boolean);
  return normalizedOptions.some((option) => YES_VALUES.includes(option)) && normalizedOptions.some((option) => NO_VALUES.includes(option));
}

/**
 * Returns the field's own wording for an option equal to `value` after
 * normalization, or null. Returning the site's exact option text (rather than
 * the saved text) guarantees we only ever fill a string the control really has.
 */
function findExactOption(field: DetectedField, value: string): string | null {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) return null;
  return (field.options ?? []).find((option) => normalizeText(option) === normalizedValue) ?? null;
}

/**
 * Every real option that belongs to the decline-to-answer cluster, deduplicated
 * by normalized text so two spellings of the same option ("Decline To Self
 * Identify" / "Decline to self-identify") do not look like an ambiguous choice.
 */
function findDeclineOptions(field: DetectedField): string[] {
  const seen = new Set<string>();
  const matches: string[] = [];

  for (const option of field.options ?? []) {
    const normalized = normalizeText(option);
    if (!normalized || seen.has(normalized)) continue;
    if (!isDeclineToAnswer(option)) continue;
    seen.add(normalized);
    matches.push(option);
  }

  return matches;
}
