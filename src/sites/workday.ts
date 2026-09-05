import type { SiteAdapter } from "../shared/types";

export const workdayAdapter: SiteAdapter = {
  name: "workday",
  matches: (url) => /(^|\.)(workdayjobs\.com|myworkdayjobs\.com|workday\.com)$/i.test(url.hostname)
};
