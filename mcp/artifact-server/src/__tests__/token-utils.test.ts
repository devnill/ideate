import { describe, it, expect } from "vitest";
import { estimateTokens } from "../token-utils.js";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns 0 for null (falsy coercion)", () => {
    // null is not a valid string but the guard `if (!text)` covers it
    expect(estimateTokens(null as unknown as string)).toBe(0);
  });

  it("returns 0 for undefined (falsy coercion)", () => {
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });

  it("returns 1 for 'hello' (5 chars)", () => {
    // Math.floor(5 / 4) = 1
    expect(estimateTokens("hello")).toBe(1);
  });

  it("returns 250 for a 1000-char string", () => {
    const s = "a".repeat(1000);
    expect(estimateTokens(s)).toBe(250);
  });

  it("documented contract: 'hello world!' (12 chars) => 3 tokens", () => {
    // Math.floor(12 / 4) = 3 — locks in the ±30% ASCII accuracy contract
    expect(estimateTokens("hello world!")).toBe(3);
  });

  it("returns an estimate for multi-byte UTF-8 text (documents the limitation)", () => {
    // JS string length counts UTF-16 code units, not bytes.
    // For common CJK characters each char is 1 code unit but 3 bytes in UTF-8.
    // The heuristic underestimates tokens for such text — this is documented.
    const cjk = "\u4e2d\u6587\u6587\u672c"; // 4 CJK chars = 4 code units
    // Math.floor(4 / 4) = 1
    expect(estimateTokens(cjk)).toBe(1);
  });
});
