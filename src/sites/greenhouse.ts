import type { SiteAdapter } from "../shared/types";

export const greenhouseAdapter: SiteAdapter = {
  name: "greenhouse",
  matches: (url) => /(^|\.)(greenhouse\.io|greenhouse\.com)$/i.test(url.hostname)
};
