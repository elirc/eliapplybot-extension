> Historical v0.2 review, before fixes. See [v0.3 fixes and current verification](FIXES.md). The characterization probes and original evidence below describe defects in the old implementation; run the current regression suite for the repaired behavior.

# eli apply mate: application review and test report

**Reviewed:** September 4, 2026 · **App:** 0.2.0 · **Commit:** `00f5ebd5aef17773eea9f46994ee35fc6a1686e2`

The app builds successfully and its existing 61 tests pass. However, the additional checks reproduce incorrect autofill, misleading success reporting, and loss of profile edits. I would address the high-priority findings below before relying on it for real applications.

The strongest parts are the small, understandable architecture, on-demand injection, limited extension permissions, local profile storage, explicit confidence gating, and refusal to click submit or upload files. The main weakness is that several broad matching rules assign **high confidence to the wrong meaning**, and the write path treats a DOM assignment as successful without checking whether the intended value survived or reached the site's application state.

This report includes **26 findings and limitations**. IDs R01–R24 correspond to reproducible review probes; R25 is the dependency audit and R26 concerns documentation. Their severity differs: an omitted field is less serious than an incorrect authorization answer or lost profile data.

**Scope and testing evidence**

Reviewed all application source modules, popup/options/sidebar styling, profile schema and persistence, scanner/matchers/filler, message routing, site adapters, background worker, manifest, build configuration, existing tests, the fake application page, and developer documentation. Reviewed the earlier `fable` findings as historical context and checked current code rather than assuming those findings still apply.

| Check | Result | Evidence |
| --- | --- | --- |
| Existing unit/integration suite | **61/61 passed**, six files | [Baseline summary](baseline-summary.txt) |
| TypeScript and production build | **Passed**, including `tsc --noEmit`, Vite, and extension bundling | [Build log](build.log) |
| Additional review checks | **58/58 passed:** 45 observations of defects/limitations plus 13 positive controls | [Results JSON](review-results.json), [test log](review-tests.log) |
| Packaged artifacts and local HTTP checks | **17/17 passed** | [Artifact results](artifact-checks.json) |
| Full dependency audit | **11 affected package entries:** 1 critical, 7 high, 2 moderate, 1 low | [Full audit](dependency-audit.json) |
| Production-only dependency audit | **0 reported vulnerabilities** | [Production audit](production-audit.json) |
| Interactive browser / installed extension | **Not completed:** browser connection failed during startup | Limits below |

**Interpret the review checks carefully:** they assert the app's observed behavior, including bugs. Their green result means the reproduction succeeded, not that the defect is fixed. They are isolated from the normal test suite, and no production source or dependency versions were changed.

Environment: Windows, Node 22.16.0, npm 10.9.2; installed React/React DOM 18.3.1, TypeScript 5.9.3, Vite 5.4.21, Vitest 1.6.1, esbuild 0.20.2, jsdom 24.1.3. Existing `README.md` edits were present before the review and were preserved. Build output in `dist` was regenerated.

The review exercised real React components in jsdom and evaluated the freshly built content script with mocked Chrome APIs. Tests used synthetic/sample profiles only. It also checked the built worker's installation handler, manifest entry points, linked assets, and a successful HTTP response from the local fake application page. The temporary HTTP server was stopped afterward.

**Highest-priority findings**

| ID | Priority | Issue | Main consequence |
| --- | --- | --- | --- |
| R01 | High | Field IDs collide after a control becomes hidden | Autofill writes into the wrong control |
| R02 | High | Authorization matching ignores country and negation | Incorrect work-authorization answers |
| R03 | High | Personal/employment rules match other people's fields and short questions | Incorrect identity or screening responses |
| R05 | High | Legends and distant sections contaminate field meaning | School names and education dates enter unrelated fields |
| R06 | High | Repeated history sections always use entry zero | Duplicate/wrong employment and education history |
| R07 | High | Date assignments can erase values while reporting success | Incomplete dates presented as filled |
| R08 | High | Existing, protected, password, and empty-value cases lack write safeguards | User data is overwritten or erased |
| R14 | High | One invalid stored profile resets the entire store | All saved versions can be lost |
| R15 | High | Concurrent storage operations overwrite one another | Successful saves/creations can disappear |
| R16 | High | First-run sample profile is immediately fillable | Placeholder identity and authorization reach applications |
| R19 | High/Medium | Detection exposes unfilled profile values; debug redaction is incomplete | Personal data crosses into page DOM or debug exports |
| R21 | High | Profile toolbar actions discard unsaved JSON | Silent loss of edits |
| R23 | High | React radio state is not updated | Visible answer differs from the site's state |

**Detailed findings and improvements**

**R01 — High — A second scan can fill a hidden control instead of the current field.**

Reproduction: scan visible First name and Last name inputs, hide First name, then autofill again. The new scan assigns Last name `eam-field-0`; the hidden First name still has that ID. Lookup returns both in document order, and filling selects the hidden First name. The reproduction writes `Example` into the hidden control and leaves the visible Last name empty while reporting success. Source: [scanner.ts](../../src/content/scanner.ts), lines 7–24, 40–48, 70–75; [filler.ts](../../src/content/filler.ts), lines 17–21. Use per-element identity and direct scan-to-element references, or clear stale IDs and use a unique scan generation. Recheck connection and visibility immediately before writing.

**R02 — High — US work authorization is applied to other countries and inverted questions.**

Questions about authorization in the United Kingdom, Canada, and Germany all produce a high-confidence `Yes` from `legallyAuthorizedUS: true`. “Are you NOT legally authorized to work in the United States?” also receives `Yes`. Source: [fieldMatchers.ts](../../src/shared/fieldMatchers.ts), lines 147–174. Restrict automatic answers to supported country-specific, affirmative question forms. Leave unknown countries, negation, and compound authorization/sponsorship questions for review. Represent authorization by jurisdiction if international applications are intended.

**R03 — High — Keyword matching confuses candidate data with other people and job questions.**

“Reference email,” “Emergency contact email,” and “Email password” all map to the candidate's email with high confidence. A short input labeled “Why do you want to work for this company?” maps to the saved employer's company name; long-form skip rules apply only to textareas. Source: [fieldMatchers.ts](../../src/shared/fieldMatchers.ts), lines 66–85, 109–144, 263–283. Check question intent and whose information is requested before matching a keyword. Apply job-specific-answer exclusions across text inputs as well as textareas. Add negative fixtures for references, emergency contacts, employer websites, credentials, and screening questions.

**R04 — Medium — Mailing/street address is filled with a location summary.**

“Mailing address” gets `San Francisco, CA` from the sample profile. A city/state summary does not supply the street address requested by the form. Source: [fieldMatchers.ts](../../src/shared/fieldMatchers.ts), lines 136–142; [types.ts](../../src/shared/types.ts), personal profile definition. Split address into explicit fields, or limit this mapping to a general location field and review street/mailing-address requests. This behavior is currently asserted as correct by an existing matcher test; that expectation should change with the fix.

**R05 — High — Broad context overrides the field's actual meaning.**

Two reproductions confirm this: a Degree input inside a “School information” fieldset receives the school name; an employment Start date receives `09/2016`, the education start date, when Education appears in an earlier section of the same form. `getBestLabel` appends the legend to the field's own label, and `getSectionText` gathers headings from ancestors that may cover other sections. Education matching runs before employment matching. Source: [domLabels.ts](../../src/content/domLabels.ts), lines 1–10, 24–39; [fieldMatchers.ts](../../src/shared/fieldMatchers.ts), lines 82–85, 236–283. Preserve separate local-label and nearest-section signals, stop at section boundaries, and require agreement before giving high confidence.

**R06 — High — Repeated employment/education rows reuse the first saved entry.**

With two different saved employers and inputs named `experience_0_company` and `experience_1_company`, both inputs receive the first employer. Both history matchers hard-code array index zero. Source: [fieldMatchers.ts](../../src/shared/fieldMatchers.ts), lines 237 and 264. Associate each form section with a specific profile entry; when that association is ambiguous, leave subsequent sections for review. Test mixed dates, current versus previous employment, and two schools, not just duplicate company labels.

**R07 — High — Native date/month/number inputs can be erased and counted as filled.**

The matcher always formats history dates as `MM/YYYY`. Assigning this to native `date`, `month`, or numeric year controls results in an empty value in the reproduction, even when the control previously held a valid value. `fillField` returns `true`. Source: [fieldMatchers.ts](../../src/shared/fieldMatchers.ts), lines 254–257, 279–282, 296–299; [filler.ts](../../src/content/filler.ts), lines 36–39. Format by control type and requested component, decline to invent a missing day, then verify the actual post-write value and validity. Count failed or rejected writes as unsure and restore their originals.

**R08 — High — Filling lacks safeguards for protected controls and existing data.**

Reproductions overwrite disabled, readonly, and password inputs labeled Email. A profile with an empty first name passes validation and clears a pre-existing name while being counted as a successful fill. Existing nonempty values are generally overwritten by design. Source: [scanner.ts](../../src/content/scanner.ts), lines 40–64; [filler.ts](../../src/content/filler.ts), lines 14–39; [profileSchema.ts](../../src/shared/profileSchema.ts), lines 19–21. Skip password and non-editable controls, reject empty proposed fills, and default to preserving user-entered values. Offer an explicit overwrite choice when replacement is useful.

**R09 — Medium — A nearby upload can suppress ordinary contact fields.**

A name input and a Resume upload inside the same simple form cause the name to be skipped because `SKIP_PATTERNS` is applied to combined nearby text. Source: [fieldMatchers.ts](../../src/shared/fieldMatchers.ts), lines 62–64 and 92–102; [domLabels.ts](../../src/content/domLabels.ts), lines 14–21. Use the field's own label/type for upload exclusions; nearby upload wording should not veto an otherwise unambiguous name/email input. This reproduction includes whitespace between labels, as normal rendered forms do.

**R10 — Medium — Option detection and option selection use incompatible representations.**

Radios labeled Yes/No with machine values `1`/`0` become options `Yes 1` and `No 0`, so the authorization matcher downgrades them. Conversely, a select displaying `true`/`false` passes the yes/no recognizer but the filler tries to select `Yes`, which does not exist. Source: [domLabels.ts](../../src/content/domLabels.ts), lines 55–62; [fieldMatchers.ts](../../src/shared/fieldMatchers.ts), lines 34–35, 301–309; [filler.ts](../../src/content/filler.ts), lines 62–88. Carry display labels and machine values separately; map to a specific option rather than translating to a second string and matching again.

**R11 — Low — C++ and C# experience values are not recovered.**

Saved six-year values for either skill produce `yearsOfExperience` with medium confidence and no value. The trailing regex word boundary does not work after `+` or `#`. Source: [fieldMatchers.ts](../../src/shared/fieldMatchers.ts), lines 215–226. Use token-aware boundaries that support punctuation. Strengthen the existing C++ test to assert the actual number and confidence; it currently checks only the category and therefore misses this bug.

**R12 — Medium — Clear undoes all accumulated fills and can discard manual corrections.**

Fill once, manually correct the value, fill again, then clear. The result returns to the value from before the first run, not the manual correction before the latest run. The rollback array accumulates throughout the page lifetime and does not compare current values with the extension's last write. Source: [contentScript.ts](../../src/content/contentScript.ts), lines 24, 43–45, 95; [filler.ts](../../src/content/filler.ts), lines 42–58. Define whether Clear means undo latest run or undo all extension writes, align the README/UI with that choice, and preserve values manually changed after autofill unless the user explicitly chooses otherwise. Retain before/after values and batch boundaries.

**R13 — Medium — Schema validation catches shape errors but misses important semantic errors.**

An invalid email, invalid LinkedIn URL, education end date before its start, and `current: false` with `end: null` all pass together. Source: [profileSchema.ts](../../src/shared/profileSchema.ts), lines 18–28, 67–68, 87–89. Validate nonempty identity values, email/URL formats, date order, and coherent current/end status. Keep legitimately optional information optional and present field-specific messages.

**R14 — High — One bad stored profile silently replaces every version.**

Create two versions, corrupt one education month in stored data, then call `getStore`. The store is replaced with one Default sample version, including removal of the other valid profile. Source: [storage.ts](../../src/shared/storage.ts), lines 30–41 and 178–194. Validate entries individually and preserve the original data for recovery. Do not persist a sample replacement over existing invalid or newer-format data. Surface a recovery error and offer export/repair. The reproduction uses mocked storage; no real user profile was altered.

**R15 — High — Concurrent storage writes lose successful changes.**

Two simultaneous `createProfile` calls both succeed but only one new version survives. A simultaneous profile save and active-profile switch can discard the saved content. Every operation reads and rewrites the whole store independently. Source: [storage.ts](../../src/shared/storage.ts), lines 72–89, 129–144. Serialize mutations across extension contexts, for example through one background-worker mutation API with a queue. Include revision checks and read the active profile/name together. A component-local lock alone would not prevent races between the popup and multiple options tabs.

**R16 — High — Placeholder profile content is immediately usable on first run.**

Fresh storage followed by `EAM_AUTOFILL` fills `Alex` and reports success. Default sample authorization is also populated in the profile. The README warns the user, but neither the popup nor the content handler enforces completion of setup. Source: [storage.ts](../../src/shared/storage.ts), lines 35–39; [sampleProfile.ts](../../src/shared/sampleProfile.ts); [Popup.tsx](../../src/popup/Popup.tsx), lines 81–84. Mark sample/new versions as unconfigured, clearly label them, and require a real-profile setup step before autofill. A blank draft is a better default for a new personal version than a plausible fictional identity.

**R17 — Medium — Checkbox grouping can hide required consent.**

Two unnamed checkboxes in one form—checked Newsletter and unchecked required Accept terms—collapse into one field. Missing-required reporting returns zero although the consent control's validity says it is missing. Source: [scanner.ts](../../src/content/scanner.ts), lines 83–105; [contentScript.ts](../../src/content/contentScript.ts), lines 122–133. Treat standalone consent checkboxes independently and evaluate each required checkbox. Group radios by actual group/form identity, not merely identical legend text or missing form IDs.

**R18 — Medium — The review panel becomes stale after clearing values.**

Autofill a required name and then clear it. Showing the last result still reports one Filled and zero Missing Required even though the input is empty. The sidebar's clear button only changes its own text. Source: [contentScript.ts](../../src/content/contentScript.ts), lines 43–52; [renderSidebar.ts](../../src/sidebar/renderSidebar.ts), lines 55–58. Update or invalidate the result after rollback and recompute the current required-field state. Label historical results explicitly if retaining them. “Required” should read “Missing required” to distinguish the count from all required fields.

**R19 — High/Medium — Detection discloses unfilled values into the page; debug redaction is incomplete.**

High: running Detect on an empty Mailing address field places `San Francisco, CA` in an open shadow root, even though no input was filled. Page scripts can read that DOM. Medium: Copy debug JSON masks `valueBefore` but retains nearby personal text; the reproduction copies a synthetic private note adjacent to the input. Source: [contentScript.ts](../../src/content/contentScript.ts), lines 63–72; [renderSidebar.ts](../../src/sidebar/renderSidebar.ts), lines 11, 63–68, 98–102. Keep profile previews in an extension-owned surface or omit values during detection. Export an explicit allowlist of structural debug fields and exclude nearby free text by default. An ordinary closed shadow root should not be treated as a complete security boundary. Revise “Nothing leaves your machine” in the README to distinguish local profile storage from values written into websites, which those sites can observe or autosave.

**R20 — Medium, capability limitation — Frames, shadow DOM, and custom widgets are unsupported.**

Same-origin iframe and open-shadow-root fixtures containing required name fields yield no detected fields. The scanner only queries the current document's native input/textarea/select elements, and injection targets only the main frame. Site adapters currently label the hostname; none implements `normalizeField`. Source: [scanner.ts](../../src/content/scanner.ts), lines 11 and 40; [Popup.tsx](../../src/popup/Popup.tsx), injection at the end of the file; [site adapters](../../src/sites/index.ts). Document the supported native-control scope, avoid implying full ATS compatibility, and add reviewed per-site fixtures before expanding support. Detect unsupported forms/widgets and explain the gap instead of silently suggesting completeness.

**R21 — High — Toolbar actions discard unsaved profile edits.**

Edit the JSON first name, then choose Duplicate, Rename, New version, or Use for autofill. Each reproduction loses the unsaved content without the discard prompt used by version selection. `refresh()` replaces the editor from storage and clears `dirty`. Export has a related ambiguity: it downloads the older saved version while a newer draft remains visible. Source: [Options.tsx](../../src/options/Options.tsx), lines 28–38, 83–125, 157–169. Centralize draft handling across every navigation/mutation/import action. Preserve drafts or provide Save / Discard / Cancel before replacing them. Export and Duplicate should explicitly state whether they use saved data or the current draft.

**R22 — Medium — Closing or reloading the editor loses unsaved changes.**

The mounted editor registers no `beforeunload` handling and does not persist a draft when dirty. Source: [Options.tsx](../../src/options/Options.tsx), state/effects and textarea handler. Add dirty-state unload protection or a recoverable local draft. Do not confuse automatic draft persistence with making an unvalidated profile active for autofill.

**R23 — High — React-controlled radios can show a value the application has not accepted.**

A real React 18 controlled radio fixture starts with state `No`. Autofill checks the Yes radio and reports success, but React's output still reads `No`. Text inputs in the paired positive control correctly update React state. The choice filler assigns `.checked` directly and dispatches input/change events, which do not trigger this React radio `onChange` path. Source: [filler.ts](../../src/content/filler.ts), lines 62–74 and 116–118. Use a framework-compatible, narrowly scoped choice interaction and verify resulting state where possible; otherwise leave the control for manual review. Add separate radio/checkbox tests for both fill and rollback and ensure any interaction never clicks navigation/submit controls.

**R24 — Low — Common Name/Surname labels are missed.**

`labelText: "Name", name: "name"` becomes `name name` and fails the anchored full-name regex. A plain Surname field also fails because the surname alternative still requires a following “name.” Source: [fieldMatchers.ts](../../src/shared/fieldMatchers.ts), lines 105–119. Match normalized signals separately or deduplicate them, support standalone Surname, and use standard autocomplete hints as an additional scoped signal.

**R25 — Medium in this app's default workflow — Development dependencies have published advisories.**

`npm audit` reports eleven affected package entries, including critical Vitest and high Vite findings. `npm audit --omit=dev` reports zero. The default test command is `vitest run`; it does not enable the UI server covered by the cited critical advisory. Both dev scripts bind to `127.0.0.1`, reducing exposure for advisories that require a network-exposed server. This is a development-tooling maintenance issue; the audit is not evidence that the installed extension can be remotely exploited.

The maintainers describe the relevant conditions in the [Vitest advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp), [Vite Windows-path advisory](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff), and [esbuild dev-server advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99). Upgrade the toolchain in a dedicated change, refresh transitive dependencies, and rerun build, baseline tests, and the focused regressions. Audit-proposed Vite/Vitest/esbuild upgrades cross major-version boundaries; do not apply `npm audit fix --force` without compatibility review. The saved audit records the exact package/advisory list observed during this review.

**R26 — Low — Current-looking training documents describe an older implementation.**

For example, [Architectural Cartographer](../architectural-cartographer/README.md), line 3, says the extension has all-URL content-script matching; current [manifest.json](../../manifest.json) does not. Other training pages call validation shallow or describe direct value assignment, despite the current nested validator and native text setter. The older Fable report is explicitly dated/versioned and should remain historical. Refresh the training materials or add prominent version/snapshot labels. Preserve the useful v0.2.0 status note in [ONBOARDING.md](../../ONBOARDING.md) and link current documentation to one maintained implementation map.

**Additional product and engineering suggestions**

| Area | Suggested improvement | Reason / validation |
| --- | --- | --- |
| Profile setup | Add a guided form with repeatable education/experience rows and an advanced JSON editor | Reduces editing mistakes; test initial setup, optional fields, and profile switching |
| Review flow | Offer a preview before writing, plus per-field approval/skip/overwrite controls | Lets users catch meaning errors before data reaches the application page |
| Review navigation | Make field entries focus/scroll their corresponding controls | Users can verify values without manually finding each label |
| Review accessibility | Give the panel a clear accessible name, deliberate focus entry/return, and status announcements | Current sidebar has no focus management or live result announcements; validate with keyboard and screen reader |
| Responsive layout | Add a narrow-width options layout and verify long profile names, zoom, and panel overlap | Options uses a fixed 240px first column and no breakpoint; visual impact still needs browser QA |
| Failure handling | Add loading/busy states and consistent catches for initial profile loading, selection, export, and clipboard failures | Popup's initial `listProfiles().then(setProfiles)` has no error handler; some async editor/clipboard paths also lack catches |
| Cross-tab consistency | Subscribe to relevant storage changes and refresh active-profile indicators carefully around drafts | Popup/options state can become stale when another context edits profiles |
| CI and regression quality | Run typecheck, baseline tests, production build, and real-browser extension smoke tests in CI | Existing tests miss popup/options/content routing; the single HTML fixture does not establish ATS compatibility |
| Test realism | Assert semantic values and accepted state, not just categories or event dispatch | C++ category-only test and native-control-only fixtures conceal bugs reproduced here |
| Scan performance | Index groups once and avoid repeatedly scanning ancestor headings | Group collection filters all choices per group; measure large and dynamic forms before optimizing |
| Packaging | Add extension icons and document supported runtime/tooling versions | Improves install recognition and reproducibility; not a build blocker |
| Scope clarity | Keep the answer bank and site adapters explicitly marked as future or partial capabilities | `futureAnswerBank` is stored/validated but not used to answer questions |

**Suggested implementation order**

1. **Protect data and answers:** R01–R03, R05–R08, R14–R16, R19, R21, R23. Keep risky cases review-only until the fix is verified. Centralize write eligibility, stable element ownership, and profile mutations.
2. **Make review and undo reliable:** R04, R09–R10, R12–R13, R17–R18, R22. Show current state, preserve edits, and make success mean an accepted value.
3. **Expand tested coverage:** representative ATS fixtures, repeated sections, native dates, controlled choices, dynamic rerendering, unsupported widgets, and extension lifecycle tests. Implement R20 incrementally with explicit support boundaries.
4. **Maintain and improve usability:** R11, R24–R26, dependency updates, guided profile forms, accessibility, responsive layout, and documentation cleanup.

Before closing a finding, convert its review probe into an ordinary regression that asserts the corrected behavior. Do not merely preserve its current green characterization result.

**Limits and remaining checks**

The in-app browser integration failed at initialization with `Cannot redefine property: process`, before any page was opened. Consequently, this review does **not** claim an installed-extension end-to-end pass, rendered screenshots, or successful behavior on live Greenhouse, Lever, Workday, or Ashby sites. The failure belongs to the review tooling; it is not an app defect. No real applications were filled or submitted.

jsdom has no layout engine. The repository's setup replaces `getBoundingClientRect` with a nonzero rectangle and emulates `innerText`; geometry, real visibility, accessible-name behavior, and screenshots need browser verification. The hidden-control reproduction uses the `hidden` property, which the scanner checks directly. React-state, storage, and type-sanitization reproductions are useful evidence but still warrant Chromium regressions after fixes.

Remaining manual/real-browser checks: install/reload/update lifecycle and Chrome permissions; cross-origin iframe restrictions; SPA control replacement after input events; actual file import/export dialogs; clipboard denial; storage quota/failure recovery; tab reload during rollback; keyboard/screen-reader and zoom/layout behavior; representative supported ATS pages using synthetic data. The profile-import test supplies a synthetic file with a `text()` method, and export captures the Blob rather than performing a browser download.

**Reproducing the review**

Run from the project root after installing the locked dependencies:

```powershell
npm.cmd test
npm.cmd run build
node node_modules/vitest/vitest.mjs run --config docs/app-review-2026-09-04/review.config.ts --reporter=default --reporter=json --outputFile=docs/app-review-2026-09-04/review-results.json
node docs/app-review-2026-09-04/verify-artifacts.mjs
npm.cmd audit
npm.cmd audit --omit=dev
```

The focused probes live in [behavior.checks.ts](behavior.checks.ts) and [ui.checks.tsx](ui.checks.tsx). Their custom configuration leaves the app's standard `*.test.ts` suite unchanged. The artifact checker starts a temporary server on `127.0.0.1:5187` and stops it after checking the fake page. The review made no app fixes; its deliverables are this report and the reproducible evidence beside it.
