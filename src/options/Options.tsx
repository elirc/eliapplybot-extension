import { useEffect, useRef, useState } from "react";
import { validateProfileDetailed } from "../shared/profileSchema";
import { createProfile, deleteProfile, exportRawStore, getProfileVersion, listProfiles, renameProfile, resetProfile, restoreProfileStore, setActiveProfile, updateProfile, type ProfileSummary } from "../shared/storage";
import type { CandidateProfile } from "../shared/types";
import { downloadBlob, slugify } from "../shared/download";
type EditorDraft = { json: string; revision: number; ready: boolean; updatedAt?: string };
type RecoverableDraft = EditorDraft & { key: string; profileId: string };

export function Options() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [revision, setRevision] = useState(0);
  const [json, setJson] = useState("");
  const [dirty, setDirty] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recoveredDrafts, setRecoveredDrafts] = useState<RecoverableDraft[]>([]);
  const lock = useRef(false);
  const [messages, setMessages] = useState(["Loading profiles..."]);
  const [error, setError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [editorId] = useState(() => {
    const id = sessionStorage.getItem("eam-editor") || crypto.randomUUID(); sessionStorage.setItem("eam-editor", id); return id;
  });
  const draftKey = (id: string) => `eam-draft:${editorId}:${id}`;
  const notify = (message: string) => { setError(false); setMessages([message]); };
  const report = (reason: unknown) => { setError(true); setMessages((reason instanceof Error ? reason.message : String(reason)).split("\n")); };
  async function load(id?: string, discardId?: string) {
    const list = await listProfiles(); setProfiles(list);
    const targetId = id ?? list.find((p) => p.active)?.id ?? list[0]?.id;
    if (!targetId) return;
    const version = await getProfileVersion(targetId);
    if (!version) throw new Error("That version no longer exists.");
    const saved = targetId === discardId ? null : localStorage.getItem(draftKey(targetId));
    let draft: EditorDraft | undefined;
    try { if (saved) draft = JSON.parse(saved); } catch { /* Preserve unreadable draft for raw export. */ }
    if (discardId) localStorage.removeItem(draftKey(discardId));
    setSelectedId(targetId); setRevision(draft?.revision ?? version.revision);
    setJson(draft?.json ?? JSON.stringify(version.profile, null, 2)); setReady(draft?.ready ?? version.configured); setDirty(!!draft);
    notify(draft ? "Recovered your unsaved draft. Review it before saving." : version.configured ? "Profile is ready for autofill." : "Complete your details, review authorization, then enable this profile below.");
  }
  useEffect(() => {
    void load().catch(report);
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local" || !changes.profileStore || lock.current) return;
      // Keep the loaded revision and draft intact so a stale save is rejected.
      void listProfiles().then(setProfiles).catch(report);
    };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);
  useEffect(() => {
    if (!dirty || !selectedId) return;
    try { localStorage.setItem(draftKey(selectedId), JSON.stringify({ json, revision, ready, updatedAt: new Date().toISOString() })); }
    catch { report("Draft backup could not be saved. Export your draft before closing this page."); }
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, selectedId, json, revision, ready]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await action(); } catch (reason) { report(reason); }
    finally { lock.current = false; setBusy(false); }
  }
  function leaveDraft(): boolean {
    if (dirty && !window.confirm("Discard unsaved edits to this version? Cancel to keep editing or export the draft first.")) return false;
    return true;
  }
  function findDrafts(): void {
    const drafts: RecoverableDraft[] = [];
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("eam-draft:")) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? "null");
        if (typeof value?.json === "string" && Number.isInteger(value.revision) && typeof value.ready === "boolean") drafts.push({ ...value, key, profileId: key.split(":").pop()! });
      } catch { /* Leave unrecognized storage untouched. */ }
    }
    setRecoveredDrafts(drafts.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")));
    notify(drafts.length ? "Choose a draft to recover or export. Drafts from other open tabs may also appear." : "No saved editor drafts found.");
  }
  function parsed(): CandidateProfile {
    let profile: unknown;
    try { profile = JSON.parse(json); } catch { throw new Error("Not valid JSON. Fix the editor or export the draft before continuing."); }
    const validation = validateProfileDetailed(profile);
    if (!validation.valid) throw new Error(validation.errors.slice(0, 12).join("\n"));
    return profile as CandidateProfile;
  }
  async function save() {
    await updateProfile(selectedId, parsed(), revision, ready);
    await load(selectedId, selectedId); notify("Saved locally.");
  }
  const selected = profiles.find((p) => p.id === selectedId);
  let guided: CandidateProfile | undefined;
  try {
    const value = JSON.parse(json);
    if (value?.personal && !Array.isArray(value.personal) && Object.values(value.personal).every((v) => typeof v === "string") &&
        typeof value.authorization?.legallyAuthorizedUS === "boolean" && typeof value.authorization?.requiresSponsorshipNowOrFuture === "boolean") guided = value;
  } catch { /* JSON editor remains available. */ }
  const edit = (value: string) => { setJson(value); setDirty(true); notify("Unsaved edits. A draft is kept on this computer."); };

  return <main className="options-shell">
    <header className="options-header"><div><h1>eli apply mate profiles</h1><p>Review your identity and US authorization answers before enabling autofill.</p></div>
      <div className="options-actions">
        <button disabled={busy} onClick={() => run(async () => { const name = window.prompt("Name for the new profile version:", `Version ${profiles.length + 1}`); if (name === null || !leaveDraft()) return; const version = await createProfile(name); await load(version.id, selectedId); })}>New version</button>
        <button disabled={busy} onClick={() => fileInput.current?.click()}>Import JSON file</button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(event) => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (file) void run(async () => {
            if (file.size > 2 * 1024 * 1024) throw new Error("Profile files must be smaller than 2 MB.");
            const value: unknown = JSON.parse(await file.text()); const validation = validateProfileDetailed(value);
            if (!validation.valid) throw new Error(`This is not a valid profile:\n${validation.errors.join("\n")}`);
            if (!leaveDraft()) return;
            const version = await createProfile(file.name.replace(/\.profile\.json$|\.json$/i, ""), value as CandidateProfile); await load(version.id, selectedId);
          });
        }} />
      </div>
    </header>
    <div className="options-body">
      <aside className="version-list" aria-label="Profile versions">{profiles.map((profile) => <button key={profile.id} disabled={busy} aria-pressed={profile.id === selectedId} className={`version-item${profile.id === selectedId ? " selected" : ""}`} onClick={() => run(async () => { if (profile.id === selectedId) return; if (leaveDraft()) await load(profile.id, selectedId); })}>
        <span className="version-name">{profile.name}</span><span className="version-meta">{profile.active ? "Active · " : ""}{profile.configured ? "Ready" : "Setup needed"}</span>
      </button>)}</aside>
      <section className="editor-pane" aria-label="Edit profile">
        <div className="editor-toolbar"><strong>{selected?.name ?? "No version selected"}</strong><div className="editor-buttons">
          <button disabled={busy || !selectedId || !dirty} onClick={() => run(save)}>Save</button>
          <button disabled={busy || !selectedId || (selected?.active && !dirty)} onClick={() => run(async () => { if (dirty) await save(); await setActiveProfile(selectedId); await load(selectedId); })}>Use for autofill</button>
          <button disabled={busy || !selectedId} onClick={() => run(async () => { const copy = await createProfile(`${selected?.name} copy`, parsed()); await load(copy.id); })}>Duplicate</button>
          <button disabled={busy || !selectedId} onClick={() => run(async () => { const name = window.prompt("New name for this version:", selected?.name); if (name === null) return; if (dirty) await save(); await renameProfile(selectedId, name); await load(selectedId); })}>Rename</button>
          <button disabled={busy || !selectedId} onClick={() => run(async () => {
            // Export even invalid JSON so a draft can always be recovered.
            downloadBlob(new Blob([json], { type: "application/json" }), `${slugify(selected?.name ?? "profile")}${dirty ? ".draft" : ".profile"}.json`);
            notify(dirty ? "Exported the current draft, including unsaved edits." : "Exported this profile. The file contains personal information.");
          })}>Export</button>
          <button disabled={busy || !selectedId} onClick={() => run(async () => { if (!window.confirm("Reset this profile to a blank draft?")) return; if (!leaveDraft()) return; await resetProfile(selectedId); await load(selectedId, selectedId); })}>Reset to blank</button>
          <button className="danger" disabled={busy || !selectedId || profiles.length < 2} onClick={() => run(async () => { if (!window.confirm(`Delete "${selected?.name}"?`)) return; if (!leaveDraft()) return; await deleteProfile(selectedId); await load(undefined, selectedId); })}>Delete</button>
        </div></div>
        {guided && <details className="guided-profile" open><summary>Contact and authorization</summary><fieldset disabled={busy} className="profile-fields">
          {Object.entries(guided.personal).map(([key, value]) => <label key={key}>{({ firstName: "First name", lastName: "Last name", email: "Email", phone: "Phone", location: "General location", linkedin: "LinkedIn URL", github: "GitHub URL", portfolio: "Portfolio URL" } as Record<string, string>)[key]}<input value={value} onChange={(event) => edit(JSON.stringify({ ...guided, personal: { ...guided.personal, [key]: event.target.value } }, null, 2))} /></label>)}
          {(["legallyAuthorizedUS", "requiresSponsorshipNowOrFuture"] as const).map((key) => <label key={key}>{key === "legallyAuthorizedUS" ? "Legally authorized to work in the US?" : "Need US sponsorship now or in the future?"}<select value={String(guided.authorization[key])} onChange={(event) => edit(JSON.stringify({ ...guided, authorization: { ...guided.authorization, [key]: event.target.value === "true" } }, null, 2))}><option value="false">No</option><option value="true">Yes</option></select></label>)}
        </fieldset></details>}
        <label><input type="checkbox" checked={ready} disabled={busy || !selectedId} onChange={(event) => { setReady(event.target.checked); setDirty(true); }} /> I reviewed this profile's identity, history, and authorization answers. Enable it for autofill after saving.</label>
        <label className="json-label">Full profile JSON (education, experience, EEO and skill years)<textarea spellCheck={false} value={json} disabled={busy || !selectedId} aria-label="Candidate profile JSON" onChange={(event) => edit(event.target.value)} /></label>
      </section>
    </div>
    <details className="recovery-controls"><summary>Recover unsaved editor drafts</summary><p>Find drafts from a closed tab or another editor session. Old revisions may require exporting and reconciling with the current saved profile.</p>
      <button disabled={busy} onClick={() => run(async () => findDrafts())}>Find saved drafts</button>
      <ul>{recoveredDrafts.map((draft) => <li key={draft.key}>
        <span>{profiles.find((profile) => profile.id === draft.profileId)?.name ?? "Deleted profile"}{draft.updatedAt ? ` · ${new Date(draft.updatedAt).toLocaleString()}` : ""}</span>{" "}
        <button disabled={busy || !profiles.some((profile) => profile.id === draft.profileId)} onClick={() => run(async () => {
          if (!leaveDraft()) return;
          await load(draft.profileId, selectedId); setJson(draft.json); setRevision(draft.revision); setReady(draft.ready); setDirty(true);
          notify("Recovered draft into this editor. Review it before saving.");
        })}>Recover draft</button>{" "}
        <button disabled={busy} onClick={() => run(async () => downloadBlob(new Blob([draft.json], { type: "application/json" }), "recovered-profile.draft.json"))}>Export draft</button>
      </li>)}</ul>
    </details>
    <details className="recovery-controls"><summary>Recover profiles from a backup</summary><p>Choose a repaired recovery backup to replace saved versions. The current store is backed up locally before replacement. Restored profiles require review before autofill.</p><input type="file" accept=".json,application/json" disabled={busy} aria-label="Restore profile recovery backup" onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (file) void run(async () => {
        if (file.size > 2 * 1024 * 1024) throw new Error("Recovery files must be smaller than 2 MB.");
        const value = JSON.parse(await file.text());
        if (!window.confirm("Replace all saved versions with this recovery backup?") || !leaveDraft()) return;
        await restoreProfileStore(value.profileStore ?? value); await load(undefined, selectedId); notify("Profiles restored. Review each profile before enabling autofill.");
      });
    }} /></details>
    <div className={`options-status options-status-${error ? "error" : "idle"}`} role="status">{messages.map((message, i) => <div key={i}>{message}</div>)}
      {error && <button disabled={busy} onClick={() => run(async () => { const raw = await exportRawStore(); downloadBlob(new Blob([JSON.stringify(raw, null, 2)], { type: "application/json" }), "profile-recovery-backup.json"); })}>Export recovery backup</button>}
    </div>
  </main>;
}
