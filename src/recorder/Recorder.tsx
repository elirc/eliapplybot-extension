import { useEffect, useRef, useState } from "react";
import { AudioRecorder, type RecorderState } from "./engine";
import { deleteRecording, getRecordingBlob, importRecording, listRecordings, type Recording } from "./database";
import { downloadBlob, slugify } from "../shared/download";

export function Recorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const [message, setMessage] = useState("Choose a source, then start recording. Audio stays on this computer.");
  const [source, setSource] = useState<"microphone" | "tab">("microphone");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [entries, setEntries] = useState<Recording[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [playback, setPlayback] = useState<{ id: string; url: string; name: string }>();
  const playbackRef = useRef<string>();
  const meter = useRef<() => void>();
  const release = useRef<() => void>();
  const sourceTab = Number(new URLSearchParams(location.search).get("sourceTab"));
  const [sourceTitle, setSourceTitle] = useState("");
  const refresh = async () => setEntries(await listRecordings());
  const clearPlayback = () => { if (playbackRef.current) URL.revokeObjectURL(playbackRef.current); playbackRef.current = undefined; setPlayback(undefined); };
  const stopMeter = () => { const stop = meter.current; meter.current = undefined; stop?.(); };
  const engine = useRef<AudioRecorder>();
  if (!engine.current) engine.current = new AudioRecorder((next, error) => {
    setState(next);
    if (next === "idle") { stopMeter(); release.current?.(); release.current = undefined; void refresh().catch((e) => setMessage(String(e))); setMessage(error || "Recording saved locally. You can play or download it below."); }
  });
  useEffect(() => {
    void refresh().catch((error) => setMessage(`Cannot open recording storage: ${String(error)}`));
    const updateDevices = () => { void navigator.mediaDevices.enumerateDevices().then((list) => setDevices(list.filter((d) => d.kind === "audioinput"))).catch(() => setMessage("Microphones could not be listed. Check Chrome's microphone permission.")); };
    updateDevices(); navigator.mediaDevices.addEventListener("devicechange", updateDevices);
    if (sourceTab > 0) void chrome.tabs.get(sourceTab).then((tab) => setSourceTitle(tab.title || "Original browser tab")).catch(() => setSourceTitle(""));
    const timer = window.setInterval(() => setElapsed(engine.current!.elapsedMs), 250);
    const beforeUnload = (event: BeforeUnloadEvent) => { if (engine.current!.state !== "idle") { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    const refreshLibrary = () => { void refresh().catch((error) => setMessage(String(error))); };
    window.addEventListener("focus", refreshLibrary);
    return () => { clearInterval(timer); navigator.mediaDevices.removeEventListener("devicechange", updateDevices); window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("focus", refreshLibrary); stopMeter(); if (playbackRef.current) URL.revokeObjectURL(playbackRef.current); void engine.current!.stop().finally(() => release.current?.()); };
  }, []);
  async function run(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(true);
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { operation.current = false; setBusy(false); }
  }
  async function start() {
    if (engine.current!.state !== "idle") return;
    let stream: MediaStream | undefined;
    try {
      // Optional permission must be requested directly from the Start button gesture.
      if (source === "tab" && !await chrome.permissions.request({ permissions: ["tabCapture"] })) throw new Error("Tab recording permission was not granted.");
      release.current = await recordingLock();
      clearPlayback();
      if (source === "microphone") {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
        setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput"));
      } else {
        if (!sourceTab) throw new Error("Open the recorder from the extension popup on the tab you want to record.");
        const current = await chrome.tabs.getCurrent();
        if (!current?.id) throw new Error("Open the recorder in its own extension tab.");
        const id = await new Promise<string>((resolve, reject) => {
          chrome.tabCapture.getMediaStreamId({ targetTabId: sourceTab, consumerTabId: current.id }, (streamId) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else if (!streamId) reject(new Error("This tab did not provide an audio stream.")); else resolve(streamId);
          });
        });
        stream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: id } } as MediaTrackConstraints, video: false });
      }
      meter.current = await connectMeter(stream, source === "tab", setLevel);
      await engine.current!.start(stream, source);
      setElapsed(0); setMessage("Recording. Keep this recorder tab open; you can close the extension popup.");
    } catch (error) { stream?.getTracks().forEach((t) => t.stop()); stopMeter(); release.current?.(); release.current = undefined; throw error; }
  }
  async function preview(entry: Recording) {
    const blob = await getRecordingBlob(entry);
    if (playbackRef.current) URL.revokeObjectURL(playbackRef.current);
    playbackRef.current = URL.createObjectURL(blob); setPlayback({ id: entry.id, url: playbackRef.current, name: entry.name });
  }
  const recording = state !== "idle";
  return <main className="recorder-shell">
    <header><h1>Local audio recorder</h1><p>Record a microphone or a desktop browser tab, or import audio from your phone.</p></header>
    <section className="record-card" aria-label="Recording controls">
      <label>Audio source<select value={source} disabled={recording || busy} onChange={(event) => setSource(event.target.value as typeof source)}><option value="microphone">Microphone / nearby speaker</option><option value="tab" disabled={!sourceTitle}>Browser tab{sourceTitle ? `: ${sourceTitle}` : " (open from the popup on that tab)"}</option></select></label>
      {source === "microphone" && <><label>Microphone<select value={deviceId} disabled={recording || busy} onChange={(event) => setDeviceId(event.target.value)}><option value="">System default</option>{devices.filter((d) => d.deviceId !== "default").map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}</select></label><p>For iPhone audio, play it through the phone's speaker near this microphone. A phone call must be on speakerphone, with participants aware of the recording. Headphone audio is not captured this way.</p></>}
      <div className="record-indicator" aria-live="polite"><span className={recording ? "record-dot active" : "record-dot"} />{state === "idle" ? "Ready" : state} · {formatDuration(elapsed)}</div>
      <label>Input level<meter min={0} max={1} value={level} aria-label="Audio input level" /></label>
      <div className="record-buttons">
        <button disabled={recording || busy} onClick={() => run(start)}>Start recording</button>
        <button disabled={busy || !["recording", "paused"].includes(state)} onClick={() => { try { state === "paused" ? engine.current!.resume() : engine.current!.pause(); } catch (error) { setMessage(String(error)); } }}>{state === "paused" ? "Resume" : "Pause"}</button>
        <button disabled={busy || !recording || state === "saving"} onClick={() => run(async () => { await engine.current!.stop(); })}>Stop and save</button>
      </div>
      <p role="status">{message}</p>
      <p className="record-note">Audio is saved every second, up to 250 MB per recording. Stop before closing this tab. After a crash, incomplete recordings may contain recoverable audio.</p>
    </section>
    <section className="record-card" aria-label="Recording library"><div className="library-heading"><h2>Recordings on this computer</h2><label className="import-audio">Import audio<input type="file" accept="audio/*,.m4a,.webm,.mp4" disabled={busy || recording} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(async () => { await importRecording(file); await refresh(); setMessage("Audio imported locally. Use Play to check it."); }); }} /></label></div>
      {playback && <div><p>{playback.name}</p><audio src={playback.url} controls onError={() => setMessage("Chrome could not play this audio format or the recording is incomplete. The original file is still available to download.")} /></div>}
      {!entries.length && <p>No recordings yet.</p>}
      <ul className="recordings">{entries.map((entry) => <li key={entry.id}><div><strong>{entry.name}</strong><p>{(entry.bytes / 1024 / 1024).toFixed(1)} MB · {entry.source} · {entry.status === "saved" ? "Saved" : "Live or incomplete — recoverable chunks"}{entry.durationMs ? ` · ${formatDuration(entry.durationMs)}` : ""}</p></div><div className="record-buttons">
        <button disabled={busy || recording || !entry.bytes} onClick={() => run(() => preview(entry))}>Play</button>
        <button disabled={busy || recording || !entry.bytes} onClick={() => run(async () => { downloadBlob(await getRecordingBlob(entry), audioFilename(entry)); })}>Download</button>
        <button className="danger" disabled={busy || recording} onClick={() => run(async () => {
          const unlock = await recordingLock();
          try { if (window.confirm(`Delete "${entry.name}" from this computer?`)) { await deleteRecording(entry.id); if (playback?.id === entry.id) clearPlayback(); await refresh(); } }
          finally { unlock(); }
        })}>Delete</button>
      </div></li>)}</ul>
    </section>
  </main>;
}
export function formatDuration(ms: number): string { const seconds = Math.floor(ms / 1000); return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
function audioFilename(entry: Recording): string {
  if (/\.(webm|m4a|mp3|wav|ogg|oga|aac|flac|mp4)$/i.test(entry.name)) return entry.name;
  const extension = entry.mimeType.includes("mp4") ? "m4a" : "webm"; return `${slugify(entry.name)}.${extension}`;
}
async function recordingLock(): Promise<() => void> {
  return new Promise((resolve, reject) => {
    void navigator.locks.request("eam-audio-recording", { ifAvailable: true }, (lock) => {
      if (!lock) { reject(new Error("Another recorder tab is already recording. Stop it first.")); return; }
      return new Promise<void>((release) => resolve(release));
    }).catch(reject);
  });
}
async function connectMeter(stream: MediaStream, playback: boolean, onLevel: (level: number) => void): Promise<() => void> {
  const context = new AudioContext();
  try {
    await context.resume();
    const source = context.createMediaStreamSource(stream); const analyser = context.createAnalyser(); analyser.fftSize = 256; source.connect(analyser);
    if (playback) source.connect(context.destination);
    const data = new Uint8Array(analyser.fftSize); let frame = 0;
    const sample = () => { analyser.getByteTimeDomainData(data); onLevel(Math.min(1, Math.sqrt(data.reduce((sum, v) => sum + ((v - 128) / 128) ** 2, 0) / data.length) * 3)); frame = requestAnimationFrame(sample); };
    sample();
    return () => { cancelAnimationFrame(frame); source.disconnect(); void context.close().catch(() => undefined); onLevel(0); };
  } catch (error) { await context.close(); throw error; }
}
