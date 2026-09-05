# Current implementation: v0.3

Updated September 4, 2026. This is the maintained implementation map. The onboarding, Fable, and training materials describe earlier versions. See [README](../README.md) for installation and usage, and [fix verification](app-review-2026-09-04/FIXES.md) for evidence and remaining checks.

## Runtime and entry points

This is a desktop Chrome Manifest V3 extension using React 18 and TypeScript. Node 22.12+ builds it with Vite 7 and esbuild. Chrome 120+ is the declared runtime minimum.

| Entry | Responsibility |
| --- | --- |
| `popup.html` / `src/popup/Popup.tsx` | Profile selection; explicitly triggered fill, detect, undo, and review; recorder launcher |
| `options.html` / `src/options/Options.tsx` | Guided contact/authorization editing, full profile JSON, version management, draft protection, recovery import/export |
| `recorder.html` / `src/recorder/Recorder.tsx` | Persistent recorder tab, source selection and permissions, input meter, recording controls, local audio library |
| `src/background/serviceWorker.ts` | Sender-checked profile messages and installation metadata |
| `src/background/profileStore.ts` | Serialized initialization, migration, reads, mutations, revision checks, and recovery |
| `src/content/contentScript.ts` | Injected on demand; serialized scan/fill/review/undo requests |
| `src/content/scanner.ts`, `domLabels.ts` | Visible native controls, scoped labels and groups, stable private element identities, accessible frames/open shadow roots |
| `src/shared/fieldMatchers.ts` | Deterministic, conservative field-to-profile matching |
| `src/content/filler.ts` | Native setters/events, eligibility and acceptance checks, last-batch undo |
| `src/sidebar/renderSidebar.ts` | Review counts, field navigation, focus handling, structural debug export |
| `src/recorder/engine.ts`, `database.ts` | Recording state machine and transactional audio chunk storage |

`manifest.json` requests only `activeTab`, `storage`, and `scripting` by default. `tabCapture` is optional and requested from the recorder's Start action. Microphone access uses Chrome's ordinary `getUserMedia` permission prompt. There are no persistent host permissions, static content-script registrations, offscreen pages, external messaging entries, or backend services.

## Profiles and drafts

Saved profiles use `chrome.storage.local.profileStore`, schema version 2. Each version has a name, ID, timestamps, `configured` flag, and revision. The schema version stays at 2 for compatible existing profile data; missing new metadata is normalized conservatively. First-run/default/reset profiles are blank and cannot autofill. New, imported, duplicated, and restored versions require an explicit review before enabling autofill. Sample contact details cannot be enabled.

All profile operations go through `EAM_STORE` to the service worker. A promise queue serializes reads, migration, and mutations. Editor saves include the loaded revision; conflicting saves fail with the draft preserved. Content scripts can request the current store but cannot mutate it or export recovery backups. No page-to-extension bridge is exposed.

Nested validation checks shape, dates/order, current/past role consistency, required identity, email, and nonblank HTTP(S) URLs. Optional empty fields remain allowed. Invalid stored data or an unsupported store version causes a recovery error without overwriting the raw data. Legacy `candidateProfile` is retained after migration.

Recovery restoration validates the complete supplied v2 store, backs up existing saved data first, replaces version IDs to invalidate old editors, and disables autofill until review. Raw backup export includes the latest pre-restoration backup. Ordinary profile imports accept a single profile; recovery imports accept a complete store or an exported wrapper containing `profileStore`. Recovery files and single-profile imports are limited to 2 MB. Backups are personal data and are not encrypted by the app.

Unsaved editor JSON is backed up in extension-origin `localStorage` with an editor/session and profile ID. `sessionStorage` identifies the editor tab. A draft recovery picker can find, recover, or export drafts from closed editor sessions, including export for a deleted profile. Navigation prompts before discarding; canceled and failed actions preserve the backup. Rename/use save valid edits first; duplicate/export use the visible editor contents. Storage-change listeners refresh profile indicators while preserving local drafts. Browser tab duplication/session restoration behavior still needs real-browser validation; export important drafts.

## Autofill contract

The popup pings the active tab and injects one bundled classic script if necessary. No field changes occur until Autofill is requested with a reviewed profile. Detect displays field structure and reasons without exposing proposed profile values in the page or clipboard.

Scanning includes visible native inputs/selects/textareas, open shadow roots, and accessible same-origin frame documents. Element IDs are private WeakMap identities, not page attributes. Groups are indexed once; named radios are scoped to their actual form/root, and checkboxes are individual controls. Labels exclude descendant control/option text. Section context comes from nearby enclosing headings/legends.

Only nonempty, high-confidence mappings reach the filler. Existing answers, disabled/read-only controls, credentials, files, and buttons are protected. Native setters and composed input/change events notify framework controls. Invalid or unaccepted assignments do not count as fills. Select labels take priority over machine values; ambiguous or disabled choices are rejected. Undo restores only the latest successful batch and preserves subsequent manual edits.

Supported automatic mappings include unambiguous candidate contact information, a single history section, month/year date components, exact skill years, explicit affirmative US authorization yes/no selects, and exact saved EEO options. Repeated history rows, radio/checkbox choices, structured addresses, dates needing a day, and ambiguous questions require manual completion. `futureAnswerBank` is stored/validated but never used to generate answers. Site modules recognize known hostnames and use generic scanning; they are not specialized ATS automation.

Cross-origin frames and custom widgets get warnings where detectable. Closed shadow roots cannot be inspected. The panel's required count describes empty visible supported controls, not the website's full validation state. Replaced/disconnected controls may need another scan. Once data is inserted into a website, that website can read or transmit it before submission. The extension never submits.

## Audio lifecycle

The recorder runs in a dedicated extension tab, independent of the popup and background worker's lifetime. A Web Lock permits one recording across recorder tabs and prevents deletion during an active recording. Start obtains a microphone stream or a tab stream, connects an input meter, then starts `MediaRecorder`. Tab capture is routed to `AudioContext.destination` so it remains audible.

The engine transitions through idle, recording, paused, and saving. It excludes paused time from duration, saves chunks about every second, serializes pending writes, flushes the final chunk before completion, and stops tracks on completion/failure. Device loss, quota/size failures, and recording errors retain previously committed chunks. A closing/crashed recorder can leave an incomplete file; chunk persistence cannot guarantee the last second or a finalized playable container.

IndexedDB database `eli-apply-mate-audio` contains `recordings` metadata and ordered `chunks`. Each append atomically updates metadata and its Blob. Each recording/import is limited to 250 MB; total usage remains subject to browser storage quota. Audio is not placed in profile storage. Imports preserve original bytes and format. Playback uses a revocable object URL; download exports the Blob; deletion removes metadata and chunks.

The extension does not directly connect to or capture internal iPhone audio. A nearby phone must play audibly into a microphone, provide a supported physical audio input, or supply an audio file for import. There is no transcription, cloud sync, call interception, or silent background capture.

## Verification and build

Run `npm ci`, `npm test`, `npm run build`, `npm run verify:extension`, and `npm audit`. Build typechecks, creates the three UI entries, bundles the worker/content script, and copies manifest/icons into `dist`. The icons are reproducible with `npm run icons`. GitHub Actions is configured for tests, build, package checks, and audit on Node 22; it has not been executed remotely in this session.

Vitest tests use jsdom, Chrome API mocks, React-controlled forms, fake IndexedDB, and a fake recording engine/device. The package checker executes the built worker with mocked Chrome APIs and serves production assets over local HTTP. These checks do not establish real-browser permissions, media quality, rendering/accessibility, or live ATS compatibility. The in-app browser tool failed during initialization in this environment; the remaining installed-extension checks are listed in the verification report.
