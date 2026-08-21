import type { SiteAdapter } from "../shared/types";

// Lever boards are jobs.lever.co / jobs.eu.lever.co, with the applicant-facing
// hire.lever.co alongside them. Anchoring on lever.co avoids claiming hosts
// like "clever.co" or "lever.com".
export const leverAdapter: SiteAdapter = {
  name: "lever",
  matches: (url) => /(^|\.)lever\.co$/i.test(url.hostname)
};
