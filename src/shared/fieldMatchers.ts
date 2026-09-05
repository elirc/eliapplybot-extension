import type { CandidateProfile, DateParts, DetectedField, FieldKind, FieldMapping } from "./types";

type Candidate = Pick<FieldMapping, "kind" | "confidence" | "reason" | "value">;
export function normalizeText(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[_\-./[\]]+/g, " ").replace(/[^a-z0-9+# ]+/g, " ").replace(/\s+/g, " ").trim();
}
const high = (kind: FieldKind, value: string | undefined, reason: string): Candidate => value?.trim() ?
  { kind, value, confidence: "high", reason } : { kind, confidence: "medium", reason: "No saved value. Complete this field manually." };
const review = (kind: FieldKind, reason: string): Candidate => ({ kind, confidence: "medium", reason });
const skip = (reason: string): Candidate => ({ kind: "unknown", confidence: "skip", reason });

export function mapFields(fields: DetectedField[], profile: CandidateProfile): FieldMapping[] {
  const mappings = fields.map((field) => mapField(field, profile));
  // Repeated history sections cannot be reliably associated with profile rows from
  // arbitrary IDs. Do not silently repeat entry zero, including the first row.
  const counts = new Map<FieldKind, number>();
  for (const mapping of mappings) if (/^(education|experience)/.test(mapping.kind)) counts.set(mapping.kind, (counts.get(mapping.kind) ?? 0) + 1);
  return mappings.map((mapping) => (counts.get(mapping.kind) ?? 0) > 1 ? {
    ...mapping, value: undefined, confidence: "medium", reason: "Repeated history fields need manual matching to the correct profile entry."
  } : mapping);
}

export function mapField(field: DetectedField, profile: CandidateProfile): FieldMapping {
  const label = normalizeText(field.labelText);
  const metadata = normalizeText([field.name, field.idAttribute].join(" "));
  const own = label || metadata || normalizeText(field.placeholder);
  const section = normalizeText(field.sectionText);
  const context = `${own} ${section}`;
  const base = { fieldId: field.id, labelText: field.labelText };
  const result = (mapping: Candidate): FieldMapping => ({ ...base, ...mapping });
  if (field.disabled || field.readOnly) return result(skip("Disabled, read-only, and custom autocomplete controls are left unchanged."));
  if (["file", "password", "hidden", "submit", "button", "reset", "image"].includes(field.inputType ?? "")) return result(skip("Protected controls, uploads, and buttons are never filled."));
  if (/\b(resume|cv|cover letter|writing sample|attachment|file upload|portfolio upload)\b/.test(own)) return result(skip("Uploads and application documents are handled manually."));
  if (field.elementType === "textarea" || /\b(why|describe|tell us|explain|essay|story)\b/.test(own)) return result(skip("Open-ended and job-specific answers require your own response."));
  if (/\b(reference|referee|emergency|supervisor|recruiter|manager|password|username|login|verification|otp|contact person)\b/.test(context)) return result(skip("This may request another person's details or account credentials."));
  if (field.valueBefore?.trim()) return result(skip("Existing answers are preserved. Clear the field yourself to replace one."));
  if (field.elementType === "checkbox" || field.elementType === "radio") return result(review("unknown", "Select these choices manually so the site's state and consent remain under your control."));

  const auth = /\b(legally authorized|authorized to work|eligible to work)\b/.test(own);
  const sponsor = /\b(sponsorship|work visa)\b/.test(own);
  if (auth || sponsor) {
    const kind = auth ? "workAuthorization" : "sponsorship";
    const country = "(?:united states(?: of america)?|u s a|u s|usa|us)";
    const clearAuthorization = new RegExp(`^(?:are you (?:currently )?)?(?:legally )?(?:authorized|eligible) to work in (?:the )?${country}$`).test(own);
    const clearSponsorship = new RegExp(`^(?:(?:will|do) you )?(?:now or in the future )?(?:require|need) (?:visa |employment |work )?sponsorship (?:now or in the future )?(?:to work |for (?:work|employment) )?in (?:the )?${country}(?: now or in the future)?$`).test(own);
    const us = auth ? clearAuthorization : clearSponsorship;
    const unknownCountry = /\b(canada|uk|united kingdom|germany|europe|australia|india|other countr|any countr)\b/.test(own);
    if (!us || unknownCountry || (auth && sponsor) || /\b(not|without|unable|unless|except|only|citizen|citizenship)\b/.test(own)) return result(review(kind, "Only clear, affirmative US authorization questions can use these saved answers."));
    if (sponsor && !/\b(require|need)\b/.test(own)) return result(review(kind, "The sponsorship question does not clearly match the saved answer."));
    const value = booleanOption(field, auth ? profile.authorization.legallyAuthorizedUS : profile.authorization.requiresSponsorshipNowOrFuture);
    return result(value ? high(kind, value, "Matched an affirmative US question and explicit yes/no options.") : review(kind, "Choose the authorization answer manually; options are not a clear yes/no pair."));
  }
  const eeo: Array<[RegExp, FieldKind, string | undefined]> = [
    [/\bgender\b/, "eeoGender", profile.eeo.gender], [/\b(race|ethnicity)\b/, "eeoRace", profile.eeo.raceEthnicity],
    [/\bveteran\b/, "eeoVeteran", profile.eeo.veteranStatus], [/\b(disability|disabled)\b/, "eeoDisability", profile.eeo.disabilityStatus]
  ];
  for (const [pattern, kind, value] of eeo) if (pattern.test(own)) {
    const option = value && field.options?.find((o) => normalizeText(o) === normalizeText(value));
    return result(option ? high(kind, option, "The saved EEO answer exactly matches an available option.") : review(kind, "No saved EEO answer exactly matches this field."));
  }
  if (/\b(years?|yrs?)\b/.test(own) && /\b(experience|exp)\b/.test(own)) {
    const skills = Object.entries(profile.experienceYears).sort((a, b) => normalizeText(b[0]).length - normalizeText(a[0]).length);
    const match = skills.find(([skill]) => {
      const normalized = normalizeText(skill);
      return normalized && new RegExp(`(?:^|[^a-z0-9+#])${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9+#])`).test(own);
    });
    return result(match ? high("yearsOfExperience", String(match[1]), "Matched an exact saved skill.") : review("yearsOfExperience", "No exact saved skill matches this question."));
  }
  const educationContext = /\b(education|school|university|college|degree|study)\b/.test(context);
  const employmentContext = /\b(experience|employment|employer|company|work history|position)\b/.test(context);
  if (educationContext && employmentContext && /\b(start|end|from|to|date|month|year|location)\b/.test(own)) return result(review("unknown", "Education and employment context conflict. Review manually."));
  if (educationContext && profile.education.length) {
    const entry = profile.education[0];
    if (/^(?:school|university|college|institution)(?: (?:or )?(?:school|university|college|institution))?(?: name)?$/.test(own)) return result(high("educationSchool", entry.school, "Matched the school label."));
    if (/^(?:degree|qualification)(?: name| type)?$/.test(own)) return result(high("educationDegree", entry.degree, "Matched the degree label."));
    if (/^(?:field of study|major|discipline)$/.test(own)) return result(high("educationFieldOfStudy", entry.fieldOfStudy, "Matched the field of study."));
    if (/\b(start|from)\b/.test(own) && /\b(date|month|year)\b/.test(own)) return result(dateMapping("educationStartDate", entry.start, field, own));
    if (/\b(end|to|graduation|graduate)\b/.test(own) && /\b(date|month|year)\b/.test(own)) return result(dateMapping("educationEndDate", entry.end, field, own));
  }
  if (employmentContext && profile.experience.length) {
    const entry = profile.experience[0];
    if ((/\b(previous|past|former)\b/.test(own) && entry.current) || (/\bcurrent\b/.test(own) && !entry.current)) return result(review("unknown", "This question's current/past role does not match the first saved employment entry."));
    if (/^(?:(?:current|previous|past) )?(?:employer(?: company)?|company|organization)(?: name)?$/.test(own)) return result(high("experienceCompany", entry.company, "Matched the employer name."));
    if (/^(?:(?:current|previous|job|position) )?(?:title|position|role)$/.test(own)) return result(high("experienceTitle", entry.title, "Matched the employment title."));
    if (/^(?:(?:job|work|employment|company|employer) )?(?:location|city)$/.test(own)) return result(high("experienceLocation", entry.location, "Matched employment location."));
    if (/\b(start|from)\b/.test(own) && /\b(date|month|year)\b/.test(own)) return result(dateMapping("experienceStartDate", entry.start, field, own));
    if (/\b(end|to)\b/.test(own) && /\b(date|month|year)\b/.test(own)) return result(entry.current ? review("experienceEndDate", "Mark this as a current role manually; do not invent an end date.") : dateMapping("experienceEndDate", entry.end, field, own));
  }
  const personal = profile.personal;
  const autocomplete = normalizeText(field.autocomplete?.split(/\s+/).pop());
  if (/^(?:(?:your|legal|preferred) )?(?:first|given) name$/.test(own) || (!label && autocomplete === "given name")) return result(high("firstName", personal.firstName, "Matched first name."));
  if (/^(?:(?:your|legal) )?(?:(?:last|family) name|surname)$/.test(own) || (!label && autocomplete === "family name")) return result(high("lastName", personal.lastName, "Matched last name."));
  if (/^(?:(?:your|legal) )?(?:full )?name$/.test(own)) return result(high("fullName", `${personal.firstName} ${personal.lastName}`.trim(), "Matched full name."));
  if (/^(?:(?:your|contact|personal) )?(?:e mail|email)(?: address)?$/.test(own)) return result(high("email", personal.email, "Matched candidate email."));
  if (/^(?:(?:your|contact|personal|primary) )?(?:phone|mobile|telephone)(?: number)?$/.test(own)) return result(high("phone", personal.phone, "Matched candidate phone."));
  if (/^(?:your )?(?:linkedin|linked in)(?: profile| url| profile url)?$/.test(own)) return result(high("linkedin", personal.linkedin, "Matched LinkedIn profile."));
  if (/^(?:your )?(?:github|git hub)(?: profile| url)?$/.test(own)) return result(high("github", personal.github, "Matched GitHub profile."));
  if (/^(?:your )?(?:portfolio(?: website| url)?|personal website|website|web site)$/.test(own) && !employmentContext) return result(high("portfolio", personal.portfolio, "Matched personal website."));
  if (/^(?:(?:your|current|home|residential) )?location$/.test(own) && !employmentContext) return result(high("location", personal.location, "Matched general location."));
  if (/\b(address|city|postal|zip)\b/.test(own)) return result(review("location", "The profile has a location summary, not a structured mailing address."));
  return result({ kind: "unknown", confidence: "low", reason: "No unambiguous mapping. Complete this field manually." });
}
function booleanOption(field: DetectedField, answer: boolean): string | undefined {
  const yes = field.options?.find((o) => ["yes", "y", "true"].includes(normalizeText(o)));
  const no = field.options?.find((o) => ["no", "n", "false"].includes(normalizeText(o)));
  return yes && no ? answer ? yes : no : undefined;
}
function dateMapping(kind: FieldKind, date: DateParts | null, field: DetectedField, label: string): Candidate {
  if (!date) return review(kind, "No saved end date. Complete or mark this section current manually.");
  if (field.inputType === "date") return review(kind, "The profile has month/year only. A complete calendar date needs your review.");
  let value: string;
  if (field.inputType === "month") value = `${date.year}-${String(date.month).padStart(2, "0")}`;
  else if (/\byear\b/.test(label) && !/\bmonth\b/.test(label)) value = String(date.year);
  else if (/\bmonth\b/.test(label) && !/\byear\b/.test(label)) {
    const monthName = new Date(Date.UTC(2000, date.month - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
    value = field.options?.find((o) => [String(date.month), String(date.month).padStart(2, "0"), monthName.toLowerCase(), monthName.slice(0, 3).toLowerCase()].includes(normalizeText(o))) ?? String(date.month);
  } else if (field.inputType === "number") return review(kind, "This numeric date field needs a specific month or year label.");
  else value = `${String(date.month).padStart(2, "0")}/${date.year}`;
  return high(kind, value, "Matched the date component and native control format.");
}
