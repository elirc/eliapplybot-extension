import { describe, expect, it } from "vitest";
import { describeEmbeddedBoard, matchAtsHost } from "./messages";

describe("matchAtsHost", () => {
  it("recognizes the embedded board hosts", () => {
    expect(matchAtsHost("boards.greenhouse.io")).toBe("Greenhouse");
    expect(matchAtsHost("job-boards.greenhouse.io")).toBe("Greenhouse");
    expect(matchAtsHost("jobs.lever.co")).toBe("Lever");
    expect(matchAtsHost("jobs.ashbyhq.com")).toBe("Ashby");
    expect(matchAtsHost("acme.wd1.myworkdayjobs.com")).toBe("Workday");
    expect(matchAtsHost("MYWORKDAYJOBS.COM")).toBe("Workday");
  });

  it("still names regional boards we cannot inject into", () => {
    // Naming a board and showing its URL needs no host permission, so the hint
    // covers more hosts than manifest.json grants injection rights for.
    expect(matchAtsHost("job-boards.eu.greenhouse.io")).toBe("Greenhouse");
    expect(matchAtsHost("jobs.eu.lever.co")).toBe("Lever");
    expect(matchAtsHost("acme.workdayjobs.com")).toBe("Workday");
  });

  it("ignores unrelated and look-alike hosts", () => {
    expect(matchAtsHost("www.acme.com")).toBeNull();
    expect(matchAtsHost("player.vimeo.com")).toBeNull();
    expect(matchAtsHost("boards.greenhouse.io.evil.com")).toBeNull();
    expect(matchAtsHost("notmyworkdayjobs.com")).toBeNull();
  });
});

describe("describeEmbeddedBoard", () => {
  it("describes an absolute board frame", () => {
    const board = describeEmbeddedBoard("https://boards.greenhouse.io/acme/jobs/12345?gh_src=x");
    expect(board).toEqual({
      ats: "Greenhouse",
      host: "boards.greenhouse.io",
      url: "https://boards.greenhouse.io/acme/jobs/12345?gh_src=x"
    });
  });

  it("resolves a protocol-relative src against the page", () => {
    const board = describeEmbeddedBoard("//jobs.lever.co/acme/abc", "https://www.acme.com/careers");
    expect(board?.ats).toBe("Lever");
    expect(board?.url).toBe("https://jobs.lever.co/acme/abc");
  });

  it("returns null for empty, relative, non-http, and non-ATS frames", () => {
    expect(describeEmbeddedBoard(null)).toBeNull();
    expect(describeEmbeddedBoard("")).toBeNull();
    expect(describeEmbeddedBoard("/local/frame.html")).toBeNull();
    expect(describeEmbeddedBoard("about:blank")).toBeNull();
    expect(describeEmbeddedBoard("javascript:void(0)")).toBeNull();
    expect(describeEmbeddedBoard("https://www.youtube.com/embed/abc")).toBeNull();
  });
});
