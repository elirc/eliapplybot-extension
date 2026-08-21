import { getSiteAdapter } from "../sites";
import type { DetectedField, FillResult, SiteAdapterName } from "./types";

export const MessageTypes = {
  Autofill: "EAM_AUTOFILL",
  Detect: "EAM_DETECT",
  Clear: "EAM_CLEAR",
  ShowLastResult: "EAM_SHOW_LAST_RESULT",
  Ping: "EAM_PING"
} as const;

export type ContentRequest =
  | { type: typeof MessageTypes.Autofill }
  | { type: typeof MessageTypes.Detect }
  | { type: typeof MessageTypes.Clear }
  | { type: typeof MessageTypes.ShowLastResult }
  | { type: typeof MessageTypes.Ping };

// An application form embedded in a cross-origin iframe on a company careers page.
// The popup shows the direct URL so the user can open the board itself.
export type EmbeddedBoard = {
  ats: string;
  host: string;
  url: string;
};

export type ContentResponse =
  | { ok: true; result: FillResult }
  | { ok: true; detected: DetectedField[] }
  | { ok: true; cleared: number }
  | { ok: true; ready: true }
  | { ok: true; embedded: EmbeddedBoard[] }
  | { ok: false; error: string };

// Display names for the boards we recognize inside an iframe. Host matching itself
// is delegated to the site adapters so there is exactly one host table in the
// codebase; a second copy here drifted out of sync almost immediately.
//
// Note this is deliberately broader than the host_permissions in manifest.json.
// Naming the board and showing its URL needs no permission at all, so a user on a
// regional board (job-boards.eu.greenhouse.io, jobs.eu.lever.co) still gets a
// useful "open the form directly" hint even though we cannot inject into it.
const ATS_LABELS: Partial<Record<SiteAdapterName, string>> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workday: "Workday"
};

export function matchAtsHost(hostname: string): string | null {
  const host = hostname.trim().toLowerCase();
  if (!host) return null;
  try {
    return ATS_LABELS[getSiteAdapter(`https://${host}`).name] ?? null;
  } catch {
    return null;
  }
}

// Returns the board description for an iframe src, or null when the frame is
// something else (analytics, video, a relative src, about:blank).
export function describeEmbeddedBoard(src: string | null | undefined, base?: string): EmbeddedBoard | null {
  if (!src) return null;
  let url: URL;
  try {
    url = new URL(src, base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const ats = matchAtsHost(url.hostname);
  if (!ats) return null;
  return { ats, host: url.hostname, url: url.href };
}
