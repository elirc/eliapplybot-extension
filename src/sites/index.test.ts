import { describe, expect, it } from "vitest";
import { getSiteAdapter } from "./index";

function siteFor(href: string): string {
  return getSiteAdapter(href).name;
}

describe("site adapters", () => {
  it("recognizes Greenhouse boards, including the current job-boards host", () => {
    expect(siteFor("https://boards.greenhouse.io/example/jobs/123")).toBe("greenhouse");
    expect(siteFor("https://job-boards.greenhouse.io/example/jobs/123")).toBe("greenhouse");
    expect(siteFor("https://job-boards.eu.greenhouse.io/example/jobs/123")).toBe("greenhouse");
    expect(siteFor("https://my.greenhouse.io/jobs/123")).toBe("greenhouse");
  });

  it("recognizes Lever and Ashby boards", () => {
    expect(siteFor("https://jobs.lever.co/example/abc-123/apply")).toBe("lever");
    expect(siteFor("https://jobs.eu.lever.co/example/abc-123")).toBe("lever");
    expect(siteFor("https://jobs.ashbyhq.com/example/abc-123/application")).toBe("ashby");
  });

  it("recognizes Workday career sites and tenants", () => {
    expect(siteFor("https://example.wd1.myworkdayjobs.com/en-US/Careers/job/123")).toBe("workday");
    expect(siteFor("https://example.wd5.myworkdayjobs.com/Careers")).toBe("workday");
    expect(siteFor("https://example.workdayjobs.com/Careers")).toBe("workday");
    expect(siteFor("https://example.wd3.myworkday.com/example/d/task/1.htmld")).toBe("workday");
  });

  it("does not claim look-alike hosts", () => {
    // The old loose patterns matched any host containing the vendor name.
    expect(siteFor("https://workday-tips.example.com/how-to-apply")).toBe("generic");
    expect(siteFor("https://notgreenhouse.io/jobs")).toBe("generic");
    expect(siteFor("https://greenhouse.io.phish.example/jobs")).toBe("generic");
    expect(siteFor("https://clever.co/careers")).toBe("generic");
    expect(siteFor("https://careers.example.com/apply")).toBe("generic");
  });

  it("falls back to the generic adapter for company career pages", () => {
    expect(siteFor("https://careers.example.org/openings/42")).toBe("generic");
  });
});
