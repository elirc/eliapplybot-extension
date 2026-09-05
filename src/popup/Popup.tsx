import { useEffect, useRef, useState } from "react";
import { MessageTypes, type ContentRequest, type ContentResponse } from "../shared/messages";
import { listProfiles, setActiveProfile, type ProfileSummary } from "../shared/storage";

export function Popup() {
  const [status, setStatus] = useState({ tone: "idle", text: "Loading profiles..." });
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const report = (error: unknown) => setStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
  useEffect(() => {
    const refresh = () => { void listProfiles().then((list) => { setProfiles(list); setStatus({ tone: "idle", text: list.find((p) => p.active)?.configured ? "Ready. Existing answers will be preserved." : "Complete profile setup in Manage profiles before autofilling." }); }).catch(report); };
    refresh();
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === "local" && changes.profileStore && !lock.current) refresh(); };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);
  const active = profiles.find((p) => p.active);
  async function action(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await task(); } catch (error) { report(error); } finally { lock.current = false; setBusy(false); }
  }
  async function run(request: ContentRequest) {
    await action(async () => {
      setStatus({ tone: "idle", text: "Checking the current page..." });
      const response = await sendToActiveTab(request);
      if (!response.ok) throw new Error(response.error);
      const text = "result" in response ? `Filled ${response.result.filled.length}, review ${response.result.unsure.length}, skipped ${response.result.skipped.length}.` :
        "detected" in response ? `Detected ${response.detected.length} fields. Review panel opened.` :
        "cleared" in response ? `Restored ${response.cleared} controls from the last fill. Manual edits were preserved.` : "Ready.";
      setStatus({ tone: "success", text });
    });
  }
  return <main className="popup-shell">
    <header className="popup-header"><h1>eli apply mate</h1><p>Review every application. Never submits.</p></header>
    <label className="profile-picker"><span>Profile version</span><select aria-label="Active profile version" value={active?.id ?? ""} disabled={busy || !profiles.length} onChange={(event) => { const id = event.target.value; void action(async () => { await setActiveProfile(id); setProfiles(await listProfiles()); setStatus({ tone: "idle", text: "Profile switched." }); }); }}>
      {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}{p.configured ? "" : " (setup needed)"}</option>)}
    </select></label>
    <section className="button-stack" aria-label="Actions">
      <button disabled={busy || !active?.configured} onClick={() => run({ type: MessageTypes.Autofill })}>Autofill empty fields</button>
      <button disabled={busy || !profiles.length} onClick={() => run({ type: MessageTypes.Detect })}>Show detected fields</button>
      <button disabled={busy} onClick={() => run({ type: MessageTypes.Clear })}>Undo last fill</button>
      <button disabled={busy} onClick={() => run({ type: MessageTypes.ShowLastResult })}>Show last review</button>
    </section>
    <div className={`status status-${status.tone}`} role="status">{status.text}</div>
    <footer className="popup-footer">
      <button className="link-button" onClick={() => action(async () => { await chrome.runtime.openOptionsPage(); })}>Manage profile versions</button>
      <button className="link-button" disabled={busy} onClick={() => action(async () => {
        const [source] = await chrome.tabs.query({ active: true, currentWindow: true });
        const url = chrome.runtime.getURL(`recorder.html${source?.id ? `?sourceTab=${source.id}` : ""}`);
        await chrome.tabs.create({ url });
      })}>Open audio recorder</button>
    </footer>
  </main>;
}
export async function sendToActiveTab(request: ContentRequest): Promise<ContentResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  try { const response = await chrome.tabs.sendMessage(tab.id, { type: MessageTypes.Ping }); if (response?.ok) return chrome.tabs.sendMessage(tab.id, request); } catch { /* Inject below. */ }
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["contentScript.js"] }); }
  catch { throw new Error("Cannot run on this page. Open an ordinary application website and try again."); }
  return chrome.tabs.sendMessage(tab.id, request);
}
