import { useEffect, useState } from "react";
import { MessageTypes, type ContentRequest, type ContentResponse, type EmbeddedBoard } from "../shared/messages";
import { listProfiles, setActiveProfile, type ProfileSummary } from "../shared/storage";

type Status = {
  tone: "idle" | "success" | "error";
  text: string;
};

// One run can touch several frames of the same tab (a careers page plus the embedded
// application board), so counts are summed rather than taken from whichever frame
// answers first.
export type TabOutcome = {
  kind: "result" | "detected" | "cleared" | "none";
  filled: number;
  unsure: number;
  skipped: number;
  detected: number;
  cleared: number;
  fieldsSeen: number;
  frames: number;
  embedded: EmbeddedBoard[];
  errors: string[];
};

export function Popup() {
  const [status, setStatus] = useState<Status>({ tone: "idle", text: "Ready for an explicit click." });
  const [busy, setBusy] = useState(false);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [embedded, setEmbedded] = useState<EmbeddedBoard[]>([]);

  useEffect(() => {
    listProfiles().then(setProfiles);
  }, []);

  const activeId = profiles.find((profile) => profile.active)?.id ?? "";

  async function switchProfile(id: string) {
    try {
      await setActiveProfile(id);
      setProfiles(await listProfiles());
      setStatus({ tone: "idle", text: "Profile switched. Autofill uses it on the next run." });
    } catch (error) {
      setStatus({ tone: "error", text: error instanceof Error ? error.message : "Could not switch profile." });
    }
  }

  async function run(request: ContentRequest) {
    setBusy(true);
    setEmbedded([]);
    setStatus({ tone: "idle", text: "Working on the current tab..." });
    try {
      const outcome = await runOnActiveTab(request);

      // Nothing fillable anywhere, but an application board is embedded here: say that
      // instead of reporting a misleading "0 fields". A Clear that did reach controls
      // still reports its own count — the hint must not swallow that confirmation.
      if (outcome.fieldsSeen === 0 && outcome.cleared === 0 && outcome.embedded.length > 0) {
        setEmbedded(outcome.embedded);
        setStatus({
          tone: "idle",
          text: "This page has no application fields of its own. The form is inside an embedded frame — open it directly and run Autofill there."
        });
        return;
      }

      if (outcome.kind === "none") {
        throw new Error(outcome.errors[0] ?? "This page did not answer.");
      }

      // A frame that failed while another succeeded must never be reported as a
      // clean success: on an embedded board the frame that failed is usually the
      // application itself, and the counts came from something else on the page.
      if (outcome.errors.length > 0) {
        setEmbedded(outcome.embedded);
        setStatus({
          tone: "idle",
          text: `${describeOutcome(outcome)} Part of the page did not answer, so this may be incomplete: ${friendlyError(outcome.errors[0])}`
        });
        return;
      }

      setStatus({ tone: "success", text: describeOutcome(outcome) });
    } catch (error) {
      setStatus({
        tone: "error",
        text: friendlyError(error instanceof Error ? error.message : String(error))
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <h1>eli apply mate</h1>
        <p>Local autofill, review first, never submit.</p>
      </header>

      <label className="profile-picker">
        <span>Profile version</span>
        <select
          value={activeId}
          disabled={busy || profiles.length === 0}
          onChange={(event) => switchProfile(event.target.value)}
          aria-label="Active profile version"
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>

      <section className="button-stack" aria-label="Actions">
        <button disabled={busy} onClick={() => run({ type: MessageTypes.Autofill })}>
          Autofill current page
        </button>
        <button disabled={busy} onClick={() => run({ type: MessageTypes.Detect })}>
          Show detected fields
        </button>
        <button disabled={busy} onClick={() => run({ type: MessageTypes.Clear })}>
          Clear values filled here
        </button>
      </section>

      <div className={`status status-${status.tone}`} role="status">
        {status.text}
      </div>

      {embedded.length > 0 && (
        <section className="status" aria-label="Embedded application form">
          {embedded.map((board) => (
            <div key={board.url} style={{ marginBottom: 6 }}>
              <button className="link-button" onClick={() => chrome.tabs.create({ url: board.url })}>
                Open the {board.ats} form in a new tab
              </button>
              <div style={{ color: "#526071", fontSize: 12, overflowWrap: "anywhere" }}>{board.url}</div>
            </div>
          ))}
        </section>
      )}

      <footer className="popup-footer">
        <button className="link-button" onClick={() => chrome.runtime.openOptionsPage()}>
          Manage profile versions
        </button>
      </footer>
    </main>
  );
}

function describeOutcome(outcome: TabOutcome): string {
  const frames = outcome.frames > 1 ? ` across ${outcome.frames} frames` : "";
  if (outcome.kind === "result") {
    return `Filled ${outcome.filled}, unsure ${outcome.unsure}, skipped ${outcome.skipped}${frames}.`;
  }
  if (outcome.kind === "detected") {
    return `Detected ${outcome.detected} fields${frames}. Review panel opened.`;
  }
  return `Cleared ${outcome.cleared} changed controls${frames}.`;
}

// Chrome's messaging and injection errors are accurate but unreadable. Translate the
// ones we recognize and pass anything else through unchanged.
export function friendlyError(message: string): string {
  const text = (message ?? "").trim();
  if (!text) return "Something went wrong. Reload the page and click again.";

  if (/receiving end does not exist|could not establish connection/i.test(text)) {
    return "This page did not answer. Reload the page and click again.";
  }
  if (/message port closed/i.test(text)) {
    return "The page navigated or closed while working. Reload the page and click again.";
  }
  if (/frame with id/i.test(text)) {
    return "Part of the page reloaded while working. Reload the page and click again.";
  }
  if (/no tab with id|tab was closed/i.test(text)) {
    return "That tab is gone. Open the job page again, then click here.";
  }
  if (
    /cannot access|missing host permission|must request permission|extension manifest|cannot be scripted|chrome:\/\/|chrome-extension:\/\/|extensions gallery/i.test(
      text
    )
  ) {
    return "Chrome does not allow the extension to run on this page. Open the application in a normal http/https tab and try again.";
  }
  return text;
}

async function runOnActiveTab(request: ContentRequest): Promise<TabOutcome> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  const tabId = tab.id;

  const frameIds = await ensureContentScript(tabId);
  const responses = await Promise.all(frameIds.map((frameId) => askFrame(tabId, request, frameId)));
  return aggregate(responses);
}

async function askFrame(tabId: number, request: ContentRequest, frameId: number): Promise<ContentResponse> {
  try {
    return (await chrome.tabs.sendMessage(tabId, request, { frameId })) as ContentResponse;
  } catch (error) {
    // One frame that navigated away or refused the script must not fail the others.
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function ensureContentScript(tabId: number): Promise<number[]> {
  // The content script is injected on demand and guards against running twice, so
  // injecting again is cheap and it hands back the frame ids to address individually.
  // allFrames only reaches subframes whose origin is in host_permissions; frames we
  // may not touch never come back, which leaves the top frame alone.
  const allFrames = await injectInto(tabId, true);
  if (allFrames.length > 0) return allFrames;

  const topFrame = await injectInto(tabId, false);
  if (topFrame.length > 0) return topFrame;

  throw new Error("Cannot run on this page. Try a normal http/https tab.");
}

async function injectInto(tabId: number, allFrames: boolean): Promise<number[]> {
  try {
    const results = await chrome.scripting.executeScript({
      target: allFrames ? { tabId, allFrames: true } : { tabId },
      files: ["contentScript.js"]
    });
    return results.map((entry) => entry.frameId).filter((frameId) => typeof frameId === "number");
  } catch {
    return [];
  }
}

export function aggregate(responses: ContentResponse[]): TabOutcome {
  const outcome: TabOutcome = {
    kind: "none",
    filled: 0,
    unsure: 0,
    skipped: 0,
    detected: 0,
    cleared: 0,
    fieldsSeen: 0,
    frames: 0,
    embedded: [],
    errors: []
  };
  const seenBoards = new Set<string>();

  for (const response of responses) {
    if (!response) continue;
    if (!response.ok) {
      outcome.errors.push(response.error);
      continue;
    }

    if ("result" in response) {
      outcome.kind = "result";
      outcome.frames += 1;
      outcome.filled += response.result.filled.length;
      outcome.unsure += response.result.unsure.length;
      outcome.skipped += response.result.skipped.length;
      outcome.fieldsSeen += response.result.detected.length;
    } else if ("detected" in response) {
      if (outcome.kind !== "result") outcome.kind = "detected";
      outcome.frames += 1;
      outcome.detected += response.detected.length;
      outcome.fieldsSeen += response.detected.length;
    } else if ("cleared" in response) {
      if (outcome.kind === "none") outcome.kind = "cleared";
      outcome.frames += 1;
      outcome.cleared += response.cleared;
    } else if ("embedded" in response) {
      for (const board of response.embedded) {
        if (seenBoards.has(board.url)) continue;
        seenBoards.add(board.url);
        outcome.embedded.push(board);
      }
    }
  }

  return outcome;
}
