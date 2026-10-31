import { describe, expect, it } from "vitest";
import { codeUrl, normalizeRepoUrl, parseCodeAnchor, revisionRef } from "../src/lib/code-link.js";

describe("code links", () => {
  it("splits an anchor into path and symbol", () => {
    expect(parseCodeAnchor("src/payments/ChargeHandler.kt#charge")).toEqual({ path: "src/payments/ChargeHandler.kt", symbol: "charge" });
    expect(parseCodeAnchor("src/a.kt")).toEqual({ path: "src/a.kt" });
  });

  it("builds a GitHub blob URL from the configured repo", () => {
    expect(codeUrl("https://github.com/acme/shop", "src/payments/ChargeHandler.kt#charge")).toBe(
      "https://github.com/acme/shop/blob/HEAD/src/payments/ChargeHandler.kt",
    );
  });

  it("accepts trailing slashes and .git, and pins a ref", () => {
    expect(codeUrl("https://github.com/acme/shop.git/", "a/b.kt", "3f2a9c1")).toBe("https://github.com/acme/shop/blob/3f2a9c1/a/b.kt");
  });

  it("uses GitLab's URL shape, and escapes odd path characters", () => {
    expect(codeUrl("https://gitlab.com/acme/shop", "src/my file.kt")).toBe("https://gitlab.com/acme/shop/-/blob/HEAD/src/my%20file.kt");
  });

  it("returns nothing without a usable repo URL", () => {
    expect(codeUrl(undefined, "a.kt")).toBeUndefined();
    expect(codeUrl("not a url", "a.kt")).toBeUndefined();
    expect(codeUrl("javascript:alert(1)", "a.kt")).toBeUndefined();
    expect(normalizeRepoUrl("ftp://example.com/x")).toBeUndefined();
  });

  it("reads the commit from a run's flowRevision", () => {
    expect(revisionRef("git:3f2a9c1")).toBe("3f2a9c1");
    expect(revisionRef("v1.2")).toBeUndefined();
    expect(revisionRef(undefined)).toBeUndefined();
  });
});
