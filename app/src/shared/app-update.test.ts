import { describe, expect, it } from "vitest";
import { friendlyUpdateError } from "./app-update";

describe("app update errors", () => {
  it("turns network and missing-release failures into safe user messages", () => {
    expect(friendlyUpdateError(new Error("net::ERR_INTERNET_DISCONNECTED"))).toContain("internet connection");
    expect(friendlyUpdateError(new Error("404 latest.yml"))).toContain("No installable update");
    expect(friendlyUpdateError(new Error("checksum mismatch"))).toContain("current version is still safe");
  });
});
