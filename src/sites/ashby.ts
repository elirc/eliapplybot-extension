import type { SiteAdapter } from "../shared/types";

// Ashby boards are jobs.ashbyhq.com (and app.ashbyhq.com for the ATS itself).
export const ashbyAdapter: SiteAdapter = {
  name: "ashby",
  matches: (url) => /(^|\.)ashbyhq\.com$/i.test(url.hostname)
};
