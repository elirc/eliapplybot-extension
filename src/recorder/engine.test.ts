import { describe, expect, it, vi } from "vitest";
import { AudioRecorder } from "./engine";
import type { Recording } from "./database";

function harness() {
  let time = 1000;
  const track = { stop: vi.fn(), addEventListener: vi.fn() };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const recorder = {
    state: "inactive", mimeType: "audio/webm", ondataavailable: undefined as any, onstop: undefined as any, onerror: undefined as any,
    start: vi.fn(function () { recorder.state = "recording"; }),
    pause: vi.fn(function () { recorder.state = "paused"; }),
    resume: vi.fn(function () { recorder.state = "recording"; }),
    stop: vi.fn(function () { recorder.state = "inactive"; recorder.ondataavailable?.({ data: new Blob(["final"]) }); recorder.onstop?.(); })
  };
  const entry: Recording = { id: "test", name: "test", source: "microphone", mimeType: "audio/webm", bytes: 0, chunks: 0, createdAt: "", status: "recording", durationMs: 0 };
  const deps = { makeRecorder: vi.fn(() => recorder as unknown as MediaRecorder), supported: vi.fn(() => true), create: vi.fn(async () => entry), append: vi.fn(async () => {}), finish: vi.fn(async () => {}), now: () => time };
  const changed = vi.fn(); const engine = new AudioRecorder(changed, deps);
  return { stream, track, recorder, deps, changed, engine, advance: (ms: number) => { time += ms; } };
}
describe("audio recording lifecycle", () => {
  it("saves periodic and final chunks before marking a recording complete", async () => {
    const h = harness(); await h.engine.start(h.stream, "microphone"); h.advance(3000);
    h.recorder.ondataavailable({ data: new Blob(["first"]) }); await h.engine.stop();
    expect(h.deps.append).toHaveBeenCalledTimes(2); expect(h.deps.finish).toHaveBeenCalledWith("test", 3000, false); expect(h.track.stop).toHaveBeenCalled(); expect(h.engine.state).toBe("idle");
    h.advance(5000); expect(h.engine.elapsedMs).toBe(3000);
  });
  it("excludes paused time and allows resuming", async () => {
    const h = harness(); await h.engine.start(h.stream, "microphone"); h.advance(1000); h.engine.pause(); h.advance(5000); expect(h.engine.elapsedMs).toBe(1000);
    h.engine.resume(); h.advance(2000); await h.engine.stop(); expect(h.deps.finish).toHaveBeenCalledWith("test", 3000, false);
  });
  it("marks a recording interrupted if persistence fails", async () => {
    const h = harness(); h.deps.append.mockRejectedValueOnce(new Error("Quota exceeded")); await h.engine.start(h.stream, "microphone");
    h.recorder.ondataavailable({ data: new Blob(["chunk"]) }); await h.engine.stop();
    expect(h.deps.finish).toHaveBeenCalledWith("test", expect.any(Number), true); expect(h.changed).toHaveBeenLastCalledWith("idle", expect.stringContaining("Quota exceeded"));
  });
  it("cleans up a stream when setup fails", async () => {
    const h = harness(); h.deps.create.mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(h.engine.start(h.stream, "microphone")).rejects.toThrow("Storage unavailable"); expect(h.track.stop).toHaveBeenCalled(); expect(h.engine.state).toBe("idle");
  });
  it("does not damage a prior recording when a later start fails", async () => {
    const h = harness(); await h.engine.start(h.stream, "microphone"); await h.engine.stop();
    h.deps.create.mockRejectedValueOnce(new Error("Storage unavailable")); await expect(h.engine.start(h.stream, "microphone")).rejects.toThrow(); expect(h.deps.finish).toHaveBeenCalledTimes(1);
  });
  it("rejects a source with no audio track", async () => {
    const h = harness(); const stream = { ...h.stream, getAudioTracks: () => [] } as MediaStream;
    await expect(h.engine.start(stream, "tab")).rejects.toThrow("audio track"); expect(h.track.stop).toHaveBeenCalled(); expect(h.deps.create).not.toHaveBeenCalled();
  });
  it("finishes as interrupted when a device disconnects", async () => {
    const h = harness(); await h.engine.start(h.stream, "microphone"); const ended = h.track.addEventListener.mock.calls.find(([type]) => type === "ended")![1]; ended(); await h.engine.stop();
    expect(h.deps.finish).toHaveBeenCalledWith("test", expect.any(Number), true); expect(h.changed).toHaveBeenLastCalledWith("idle", expect.stringContaining("disconnected"));
  });
});
