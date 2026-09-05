import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Recorder } from "./Recorder";
import { installChromeMock } from "../test/chromeMock";
import { listRecordings } from "./database";

vi.mock("./database", () => ({ listRecordings: vi.fn().mockResolvedValue([]), deleteRecording: vi.fn(), getRecordingBlob: vi.fn(), importRecording: vi.fn(), createRecording: vi.fn(), appendChunk: vi.fn(), finishRecording: vi.fn() }));
let root: Root;
let getUserMedia: ReturnType<typeof vi.fn>;
let permission: ReturnType<typeof vi.fn>;
let unlock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.mocked(listRecordings).mockResolvedValue([]);
  installChromeMock(); document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState({}, "", "?sourceTab=7");
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  getUserMedia = vi.fn().mockRejectedValue(new DOMException("Microphone permission denied", "NotAllowedError"));
  permission = vi.fn().mockResolvedValue(false); unlock = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { enumerateDevices: vi.fn().mockResolvedValue([]), getUserMedia, addEventListener: vi.fn(), removeEventListener: vi.fn() } });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn(async (_name, _options, callback) => { await callback({ name: "eam-audio-recording" }); unlock(); }) } });
  (chrome as any).tabs = { get: vi.fn().mockResolvedValue({ id: 7, title: "Test audio tab" }), getCurrent: vi.fn().mockResolvedValue({ id: 8 }) };
  (chrome as any).permissions = { request: permission };
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => { await act(async () => root.unmount()); window.history.replaceState({}, "", "/"); vi.restoreAllMocks(); });
const render = async () => { await act(async () => root.render(<Recorder />)); };
const start = async () => { await act(async () => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Start recording")!.click()); };
const chooseTab = async () => { await act(async () => Simulate.change(document.querySelector("select")!, { target: { value: "tab" } } as any)); };

describe("recorder permissions and source errors", () => {
  it("opens the library without requesting microphone or tab capture access", async () => {
    await render(); expect(getUserMedia).not.toHaveBeenCalled(); expect(permission).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("No recordings yet");
  });
  it("reports microphone denial and releases the recording lock", async () => {
    await render(); await start(); expect(document.querySelector('[role="status"]')!.textContent).toContain("Microphone permission denied");
    expect(unlock).toHaveBeenCalled(); expect(document.querySelectorAll("button")[0].disabled).toBe(false);
  });
  it("does not acquire audio when optional tab permission is denied", async () => {
    await render(); await chooseTab(); await start();
    expect(permission).toHaveBeenCalledWith({ permissions: ["tabCapture"] }); expect(getUserMedia).not.toHaveBeenCalled();
    expect(document.querySelector('[role="status"]')!.textContent).toContain("not granted");
  });
  it("reports tab capture failure and releases the lock", async () => {
    permission.mockResolvedValue(true);
    (chrome as any).tabCapture = { getMediaStreamId: (_options: unknown, callback: (id: string) => void) => {
      (chrome.runtime as any).lastError = { message: "The source tab was closed" }; callback(""); delete (chrome.runtime as any).lastError;
    } };
    await render(); await chooseTab(); await start();
    expect(getUserMedia).not.toHaveBeenCalled(); expect(unlock).toHaveBeenCalled(); expect(document.querySelector('[role="status"]')!.textContent).toContain("source tab was closed");
  });
  it("prevents simultaneous recording from another recorder tab", async () => {
    (navigator.locks.request as any).mockImplementation(async (_name: string, _options: unknown, callback: (lock: null) => unknown) => callback(null));
    await render(); await start(); expect(getUserMedia).not.toHaveBeenCalled();
    expect(document.querySelector('[role="status"]')!.textContent).toContain("already recording");
  });
});
