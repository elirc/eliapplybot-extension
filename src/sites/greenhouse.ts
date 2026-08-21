import type { SiteAdapter } from "../shared/types";

// Greenhouse serves boards from several subdomains of greenhouse.io:
// boards.greenhouse.io (classic), job-boards.greenhouse.io (current UI),
// their EU equivalents (boards.eu / job-boards.eu), and app.greenhouse.io.
// Matching the registrable domain covers all of them without matching an
// unrelated host that merely contains "greenhouse".
export const greenhouseAdapter: SiteAdapter = {
  name: "greenhouse",
  matches: (url) => /(^|\.)greenhouse\.(io|com)$/i.test(url.hostname)
};
