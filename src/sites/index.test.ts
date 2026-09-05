import { describe, expect, it } from "vitest";
import { getSiteAdapter } from "./index";
describe("site recognition", () => {
  it.each([["https://boards.greenhouse.io/example", "greenhouse"], ["https://jobs.lever.co/example", "lever"], ["https://example.myworkdayjobs.com/jobs", "workday"], ["https://jobs.ashbyhq.com/example", "ashby"]])("recognizes %s", (url, name) => expect(getSiteAdapter(url).name).toBe(name));
  it.each(["https://greenhouse.io.example.org", "https://jobs.lever.example.org", "https://notworkday.example.org", "https://ashbyhq.com.example.org"])("uses generic scanning for unrelated host %s", (url) => expect(getSiteAdapter(url).name).toBe("generic"));
});
