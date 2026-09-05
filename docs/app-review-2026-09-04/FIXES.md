# v0.3 fixes and verification

September 4, 2026. The original [v0.2 review](REPORT.md) remains historical evidence. This report covers the implementation after the request to fix the app and add the discussed local recording paths. No real application was submitted, no private audio was recorded, and no extension was published or installed into the user's Chrome profile.

The reproduced defects have corrections or conservative manual handling. R20 is only partially expanded: open shadow roots and accessible same-origin frames work in the automated fixtures; custom controls, cross-origin frames, and closed roots still require manual review. This is not a claim of universal form compatibility.

## Findings addressed

| Finding | Result in v0.3 |
| --- | --- |
| R01: colliding field identities | Private stable element identities and a refreshed registry prevent a rescan from targeting a hidden/stale control. |
| R02: country/negation errors | Only narrowly matched affirmative US questions and explicit yes/no selects use saved authorization. Negated, compound, unspecified, and foreign-country questions remain manual. |
| R03: wrong person's data and screening questions | Own-label rules, credential/other-person exclusions, and conservative employment matching prevent the reproduced incorrect fills. Current employment is not copied into a previous-employer field. |
| R04: location used as mailing address | Structured address fields remain manual; general location is a distinct mapping. |
| R05: legend/section contamination | Control labels and scoped headings are separate; distant sections and option text no longer define a field's meaning. |
| R06: repeated entry zero | Repeated history mappings are downgraded to manual association instead of duplicating the first entry. |
| R07: incorrect date representation | Native month and explicit numeric date components use the right format. Missing calendar days/current-role ends remain manual. Rejected values are not reported as successful. |
| R08: overwrite/protected/empty writes | Central write eligibility preserves existing answers, protected controls, and absent profile values; native validity is checked before/after events. |
| R09: adjacent upload suppresses contact | Upload classification uses the control's own context. |
| R10: option representation mismatch | Detected labels are separated from machine values; visible select labels take priority, true/false/Y/N options map explicitly, and duplicate/disabled matches are rejected. Choices requiring radio/checkbox actions remain manual. |
| R11: C++/C# skills | Skill punctuation and exact token boundaries are preserved, including Java versus JavaScript. |
| R12: destructive accumulated rollback | Undo restores the latest successful batch and leaves later manual edits intact. |
| R13: shallow semantic validation | Empty required identity, invalid email/URLs, inverted dates, inconsistent current roles, and invalid skill values are rejected. |
| R14: malformed store data loss | Invalid/newer data is preserved; raw export and validated recovery restoration are available. The old store is backed up before replacement; backup-write failure aborts restoration. |
| R15: concurrent storage loss | The worker serializes all operations; loaded revisions reject stale editor saves. Restoring a backup invalidates old editor IDs. |
| R16: sample first run | New/reset profiles start blank, and autofill requires explicit review. Sample contact details cannot be enabled. |
| R17: hidden required consent | Checkboxes are individual fields; required/ARIA-required consent is counted independently. Enabled radio choices remain visible to required checks even when another option is disabled. |
| R18: stale clear review | Undo rescans and renders current missing fields with cleared counts. Show-last refreshes the scan. |
| R19: profile/debug disclosure | No proposed values or profile name are inserted into the page review. Debug export uses an allowlist of structural properties, excluding values, labels, names, context, and option strings. |
| R20: unsupported page structures | Native fields in open shadow roots and accessible same-origin frames are scanned and filled; detectable unsupported structures get warnings. Remaining platform/custom-widget limits are explicit. |
| R21: toolbar loses draft | Rename/use save valid current edits; duplicate/export use visible edits. Navigation prompts, and canceled/failed actions preserve local backups. |
| R22: editor reload loses draft | Local draft backups and a before-unload warning protect editing. Recovery is tested on remount and through a recovery picker in a new editor session after the original tab closes. |
| R23: React radio state mismatch | Radios/checkboxes are left for manual selection. React-controlled text fill/undo is tested against actual component state. |
| R24: Name/Surname missed | Exact contact-label matching handles these labels independently from duplicated metadata. |
| R25: dependency advisories | Vite/Vitest/plugin/esbuild and the lockfile were updated; the recorded full dependency audit has zero known advisories. |
| R26: outdated documentation | Current architecture/usage documents were added or updated. Onboarding and training pages prominently identify their historical status. |

Ordinary regressions now assert corrected behavior under `src/**/*.test.ts(x)`. The original `behavior.checks.ts`, `ui.checks.tsx`, `review-results.json`, and original artifact checker describe the old implementation and should not be treated as current passing regressions.

## Additional improvements

- Guided contact/US-authorization fields alongside the full JSON editor; loading/error states and action locks; storage-change refresh without discarding drafts.
- Review entries focus/scroll their fields, an accessible panel name, deliberate focus entry/return, Escape close, status announcements, and handled clipboard denial.
- Responsive options layout, wrapping long names/labels, visible keyboard focus, and narrow-panel count layout. Actual screen-reader, zoom, and rendered layout testing remains open.
- Indexed radio grouping, scoped section lookup, anchored ATS hostname recognition, documented runtime versions, and reproducible extension icons.
- CI configuration for tests, typechecking/build, package validation, and dependency audit. Remote CI execution has not been performed.

The earlier suggestions for repeatable guided history forms, per-field preview/approval/overwrite, dedicated ATS adapters, and real-browser CI remain future enhancements. Current history JSON and manual review cover those cases; implementing automatic overwrites or custom-widget clicks would require additional product choices and browser fixtures.

## Recording delivered

A dedicated local recorder tab supports microphone/device selection, desktop Chrome tab audio, and importing transferred phone recordings. It includes Start, Pause/Resume, Stop and save, elapsed time, input level, a local library, playback, download, and delete. Optional tab permission and microphone permission are requested only when starting the relevant source. Closing the popup does not end a recording; closing the recorder itself can interrupt it.

MediaRecorder chunks are committed to IndexedDB about every second. Finalization waits for queued writes. Quota/size errors and disconnected sources preserve earlier chunks and identify the recording as interrupted where final metadata can be saved. The cap is 250 MB per recording/import, subject to the browser's total quota. Cross-tab locking prevents concurrent recording and deletion during capture. Imported files retain their original bytes; codec/container support determines playback.

An iPhone playing YouTube or a speakerphone call can be captured acoustically by the selected computer microphone. A transferred phone recording can be imported. The extension cannot directly access an iPhone's internal audio over proximity or bypass phone/platform capture restrictions. The UI explains speaker versus headphone behavior and participant awareness for calls. There is no transcription, cloud storage, or automatic upload.

## Verification evidence

| Check | Result and evidence |
| --- | --- |
| Regression suite | **166 tests passed across 16 files.** Final results in [fix-test-results.json](fix-test-results.json) and [test log](fix-test.log). Includes matching/filling, controlled React text, popup/content routing, editor actions/drafts, concurrent storage, recovery, recording permissions/errors, engine pause/finalization, and IndexedDB byte preservation. |
| Typecheck and production build | Passed; see [build log](fix-build.log). All three extension pages, worker, content script, and icons are built into `dist`. |
| Production package and HTTP delivery | 40 checks passed; see [artifact evidence](fix-artifact-checks.json). Covers versions, manifest access, optional capture permission, all entry points/resources, PNG dimensions, CSP-compatible page scripts, worker sender restrictions and real bundled storage operations, and HTTP delivery. |
| Dependency audit | Zero known vulnerabilities in production and development dependencies at this run; see [audit JSON](fix-dependency-audit.json). |
| Browser automation | Blocked before opening a page: browser runtime initialization raised `Cannot redefine property: process`. A kernel reset and retry produced the same error. |

Synthetic tests do not exercise an actual microphone, iPhone, browser media codec, Chrome permission prompt, or live ATS. jsdom uses a geometry shim and has no rendering engine; screenshots and visual QA were not obtained. Recordings in tests use synthetic bytes/devices. No live microphone access or call recording was attempted.

To reproduce current checks:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run verify:extension
npm.cmd audit
```

The build recreates only the project's `dist` directory. The package verifier uses a temporary Vite preview server on `127.0.0.1:5187` and stops it afterward.

## Remaining installed-extension checks

Load/reload `dist` in desktop Chrome and use synthetic profile details on the local fake application. Verify first-run review gating, field values and site state, undo/manual edits, same-origin and cross-origin frames, keyboard/focus/zoom, imports/exports, recovery, and extension update retention. Test representative ATS forms before depending on them; specialized adapters are not implemented.

For audio, test microphone grant/denial and device changes; nearby speaker and speakerphone quality; desktop tab permission/capture/continued playback; pause/resume and final downloaded playback; imported iPhone M4A; popup closure; recorder/tab/source closure; browser storage pressure; and cross-tab locking. A hard crash may lose the last uncommitted chunk or leave an unfinalized media container. Verify recovered playback in actual Chrome and download important recordings.

The updated extension is built locally. Loading/reloading it in the user's Chrome profile and these hardware/browser checks remain outside the automated verification completed here.
