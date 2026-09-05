# eli apply mate

A local, personal Chrome extension that fills in the repetitive parts of job application forms — name, email, phone, links, education, work history — from a profile you control. It only fills fields it's highly confident about, shows you everything it did before you touch anything else, and never submits anything on its own.

- No backend, API keys, analytics, or app-initiated network uploads. Values filled into a website are visible to that website and may be transmitted by it before submission.
- Saved profiles live in `chrome.storage.local`; editor drafts use extension-local storage. Audio stays in the extension's local IndexedDB until you download it.
- It never clicks Submit, Apply, Continue, Next, or Finish.
- It only runs on a tab after you click the extension icon — it doesn't run in the background on every page you visit.

## 1. Install it

```sh
npm ci
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `dist` folder (created by `npm run build`).
5. Pin **eli apply mate** to your toolbar so it's one click away.

Whenever you pull code changes later, run `npm run build` again and click the reload icon on the extension's card in `chrome://extensions`.

Requires Node.js 22.12+ to build and desktop Chrome 120+ to run. Keep the same unpacked extension folder when updating to retain local data. Back up profiles and download important recordings before uninstalling.

## 2. Set up your real profile

The extension starts with a **blank draft and autofill disabled**. Existing profiles also need review after upgrading from v0.2:

1. Right-click the extension icon → **Options** (or find it from the extension's card in `chrome://extensions`).
2. Enter contact information and US authorization using the guided fields. Edit education, work history, optional EEO answers, and skill years in the full JSON editor.
3. Review your details, select **I reviewed this profile...**, then **Save**. Invalid dates, email/URLs, and sample contact details cannot be enabled for autofill.

**Multiple versions:** if you keep more than one resume (e.g. frontend vs. backend), create a separate profile version for each:

- **New version** starts blank.
- **Duplicate** copies the current editor contents, including valid unsaved edits.
- **Import JSON file** reads a local `.json` profile (validated first) and makes it active. New, imported, and duplicated profiles require review before autofill.
- **Export** downloads the visible editor contents, including an unfinished draft. Treat this file like a resume backup; it contains personal information.
- Whichever version is marked active is what autofill uses. You can also switch versions from the popup's **Profile version** dropdown right before filling a page.

Unsaved edits are backed up on this computer. Closing with changes prompts a warning; reopening the same tab can recover the draft. From a new tab, use **Recover unsaved editor drafts → Find saved drafts** to recover or export an earlier draft. Stale saves from another window are rejected. If saved data needs repair, **Export recovery backup**, repair a copy, then use **Recover profiles from a backup**. Restoration preserves a local copy of the previous store and requires profile review again.

## 3. Use it on a real application

1. Open the job application page.
2. Click the extension icon.
3. Choose **Autofill empty fields**.
4. A review panel appears on the page showing what was **filled**, **skipped**, **unsure**, and any **missing required** fields. Press Escape to close it.
5. Check the filled values against the actual form, fill in anything left for you (resumes, cover letters, and free-text answers are intentionally skipped), and submit the application yourself.

If something looks wrong, **Undo last fill** reverses the latest batch while preserving later manual edits. **Show detected fields** reviews the page without filling it. Missing-required counts cover visible supported controls; the website still performs its own validation.

## Record or import audio

Open the extension popup and choose **Open audio recorder**. The recorder opens in its own tab; keep that tab open until **Stop and save** finishes. You can close the popup.

- **Microphone / nearby speaker:** select a microphone, click **Start recording**, and grant Chrome microphone access. An iPhone playing YouTube or a speakerphone call can be recorded acoustically when its speaker is audible near that microphone. Let call participants know you are recording. Audio inside headphones is not picked up this way.
- **Browser tab:** open the popup on the desktop Chrome tab playing audio, open the recorder, choose that tab source, then start. Chrome requests optional tab-capture permission. The tab remains audible during capture. Protected or restricted sources may refuse capture.
- **Import audio:** transfer a recording from your phone to this computer and import its M4A, MP3, WAV, WebM, OGG, AAC, or FLAC file. Files are kept in their original format; playback depends on Chrome's codec support.

Pause/resume, an input-level meter, playback, download, and delete are included. Recordings save in chunks about once per second with a 250 MB per-recording/import limit. A crash can leave an incomplete recording with recoverable chunks; download important audio. Only one recorder tab can record at once. Nothing transcribes or uploads recordings.

This desktop extension cannot directly capture an iPhone's internal YouTube or call audio merely because the phone is nearby. Use its speaker, an imported recording, or a supported audio input/interface. Real-device recording and Chrome permission flows still need an installed-extension smoke test; see the [verification report](docs/app-review-2026-09-04/FIXES.md).

## What it won't do

- It won't upload your resume or any files.
- It won't answer open-ended or job-specific text questions.
- It won't guess at anything uncertain — those fields are left for you to fill and are called out in the review panel.
- It won't click any button that moves you toward submitting.
- Radio buttons, checkboxes/consent, custom widgets, ambiguous authorization, repeated history rows, structured mailing addresses, and dates requiring an unknown day remain for manual entry.
- Visible native controls in open shadow roots and accessible same-origin frames are scanned. Cross-origin frames, closed shadow roots, and unsupported widgets require manual review. Site names are recognized; there are no dedicated ATS automation adapters yet.

## Try it safely first (optional)

There's a local fake application page for testing the extension without touching a real job site:

```sh
npm run serve:test
```

Then open `http://127.0.0.1:5174/fake-application.html` and run **Autofill empty fields** on it with a reviewed test profile.

## Troubleshooting

- **Nothing happens when I click autofill** — reload the extension in `chrome://extensions` after any rebuild, and make sure you're on the tab you want to fill (it only injects into the active tab you clicked from).
- **A field I expected to fill shows as "unsure"** — that's intentional; the extension only fills fields it can match with high confidence based on the field's own label.
- **My profile won't save** — the options page will show which nested field failed validation (e.g. a bad date or a missing required value); fix that field and save again.

## For developers

Run `npm test`, `npm run build`, `npm run verify:extension`, and `npm audit`. CI runs these checks on Node 22. The package checker verifies built files, worker messages, permissions, icons, and local HTTP delivery; it does not install the extension in a browser.

See [current architecture](docs/ARCHITECTURE.md), the [original review](docs/app-review-2026-09-04/REPORT.md), and the [fixes and verification report](docs/app-review-2026-09-04/FIXES.md). [ONBOARDING.md](./ONBOARDING.md) and its linked training documents are historical learning material.
