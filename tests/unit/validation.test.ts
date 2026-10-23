import { describe, expect, it } from "vitest";
import { kindFromMime, MAX_FILE_BYTES, sanitizeFileName, validateFile, validateUsername } from "@/lib/validation";

describe("validateUsername", () => {
  it("normalises and accepts valid names", () => expect(validateUsername("  Rocky_01 ")).toEqual({ ok: true, value: "rocky_01" }));
  it("rejects short, long, and illegal characters", () => {
    expect(validateUsername("ab").ok).toBe(false);
    expect(validateUsername("a".repeat(25)).ok).toBe(false);
    expect(validateUsername("bad name!").ok).toBe(false);
  });
});
describe("validateFile", () => {
  it("accepts allowed types under the limit", () => expect(validateFile({ size: 1000, type: "image/png" }).ok).toBe(true));
  it("accepts recorder mime types with codec params", () => expect(validateFile({ size: 1000, type: "audio/webm;codecs=opus" }).ok).toBe(true));
  it("rejects oversize, empty, and disallowed types", () => {
    expect(validateFile({ size: MAX_FILE_BYTES + 1, type: "image/png" }).ok).toBe(false);
    expect(validateFile({ size: 0, type: "image/png" }).ok).toBe(false);
    expect(validateFile({ size: 10, type: "application/x-msdownload" }).ok).toBe(false);
    expect(validateFile({ size: 10, type: "text/html" }).ok).toBe(false);
  });
});
describe("helpers", () => {
  it("maps mime types to message kinds", () => {
    expect(kindFromMime("image/webp")).toBe("image");
    expect(kindFromMime("video/mp4")).toBe("video");
    expect(kindFromMime("audio/ogg")).toBe("audio");
    expect(kindFromMime("application/pdf")).toBe("file");
  });
  it("sanitises file names", () => {
    const n = sanitizeFileName("../../etc/pass wd.png");
    expect(n).not.toMatch(/[\/\s]/);
    expect(n.startsWith(".")).toBe(false);
    expect(n.endsWith("pass_wd.png")).toBe(true);
    expect(sanitizeFileName("...")).toBe("file");
  });
});
