import { appendChunk, createRecording, finishRecording, type Recording } from "./database";

export type RecorderState = "idle" | "recording" | "paused" | "saving";
type Dependencies = {
  makeRecorder(stream: MediaStream, options: MediaRecorderOptions): MediaRecorder;
  supported(type: string): boolean;
  create: typeof createRecording; append: typeof appendChunk; finish: typeof finishRecording;
  now(): number;
};
const defaults: Dependencies = { makeRecorder: (s, o) => new MediaRecorder(s, o), supported: (type) => MediaRecorder.isTypeSupported(type), create: createRecording, append: appendChunk, finish: finishRecording, now: () => Date.now() };

export class AudioRecorder {
  state: RecorderState = "idle";
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private entry?: Recording;
  private pending: Promise<void> = Promise.resolve();
  private stopped?: Promise<void>;
  private startedAt = 0;
  private pauseStarted = 0;
  private pausedMs = 0;
  private durationMs = 0;
  private failure: unknown;
  private starting = false;
  constructor(private changed: (state: RecorderState, error?: string) => void, private deps = defaults) {}
  get elapsedMs(): number { return this.state === "idle" || this.state === "saving" ? this.durationMs : Math.max(0, (this.state === "paused" ? this.pauseStarted : this.deps.now()) - this.startedAt - this.pausedMs); }
  private update(state: RecorderState, error?: string) { this.state = state; this.changed(state, error); }
  async start(stream: MediaStream, source: Recording["source"]): Promise<void> {
    if (this.state !== "idle" || this.starting) { stream.getTracks().forEach((t) => t.stop()); throw new Error("A recording is already running."); }
    this.starting = true; this.failure = undefined; this.entry = undefined; this.stopped = undefined; this.durationMs = 0; this.pending = Promise.resolve(); this.stream = stream;
    try {
      if (!stream.getAudioTracks().length) throw new Error("This source did not provide an audio track.");
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(this.deps.supported);
      if (!mimeType) throw new Error("This browser does not support audio recording. Use a current Chrome version.");
      const recorder = this.deps.makeRecorder(stream, { mimeType, audioBitsPerSecond: 128000 });
      this.recorder = recorder; this.entry = await this.deps.create(source, recorder.mimeType || mimeType);
      const entry = this.entry;
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        this.pending = this.pending.then(() => this.failure ? undefined : this.deps.append(entry.id, event.data)).catch((error) => { this.failure = error; if (recorder.state !== "inactive") recorder.stop(); });
      };
      this.stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => {
          const duration = this.elapsedMs; this.durationMs = duration; this.update("saving");
          this.stopTracks();
          void this.pending.then(() => this.deps.finish(entry.id, duration, !!this.failure)).catch((error) => { this.failure = error; }).finally(() => {
            this.update("idle", this.failure ? `${this.failure instanceof Error ? this.failure.message : String(this.failure)} Earlier saved chunks remain in the library.` : undefined);
            resolve();
          });
        };
      });
      recorder.onerror = () => { this.failure = new Error("The audio device stopped recording."); if (recorder.state !== "inactive") recorder.stop(); };
      stream.getAudioTracks().forEach((track) => track.addEventListener("ended", () => { if (recorder.state !== "inactive") { this.failure = new Error("The audio source disconnected."); recorder.stop(); } }, { once: true }));
      this.startedAt = this.deps.now(); this.pausedMs = 0; this.pauseStarted = 0;
      recorder.start(1000); this.update("recording");
    } catch (error) {
      this.stopTracks(); if (this.entry) await this.deps.finish(this.entry.id, 0, true).catch(() => undefined);
      this.update("idle"); throw error;
    } finally { this.starting = false; }
  }
  pause(): void { if (this.state === "recording") { this.recorder!.pause(); this.pauseStarted = this.deps.now(); this.update("paused"); } }
  resume(): void { if (this.state === "paused") { this.recorder!.resume(); this.pausedMs += this.deps.now() - this.pauseStarted; this.update("recording"); } }
  async stop(): Promise<void> {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    await this.stopped;
  }
  private stopTracks(): void { this.stream?.getTracks().forEach((track) => track.stop()); }
}
