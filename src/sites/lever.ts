import type { SiteAdapter } from "../shared/types";

export const leverAdapter: SiteAdapter = {
  name: "lever",
  matches: (url) => /(^|\.)lever\.co$/i.test(url.hostname)
};
