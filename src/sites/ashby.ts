import type { SiteAdapter } from "../shared/types";

export const ashbyAdapter: SiteAdapter = {
  name: "ashby",
  matches: (url) => /(^|\.)ashbyhq\.com$/i.test(url.hostname)
};
