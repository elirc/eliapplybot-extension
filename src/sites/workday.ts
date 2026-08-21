import type { SiteAdapter } from "../shared/types";

// Workday career sites live on <tenant>.<wdN>.myworkdayjobs.com (plus the older
// workdayjobs.com), and Workday tenants themselves on <tenant>.wdN.myworkday.com.
// Anchoring on the registrable domain keeps unrelated hosts that merely contain
// the word "workday" (a blog, an agency, a careers page about Workday roles)
// from being claimed by this adapter.
export const workdayAdapter: SiteAdapter = {
  name: "workday",
  matches: (url) =>
    /(^|\.)(myworkdayjobs\.com|workdayjobs\.com)$/i.test(url.hostname) ||
    /(^|\.)wd\d+\.myworkday\.com$/i.test(url.hostname)
};
