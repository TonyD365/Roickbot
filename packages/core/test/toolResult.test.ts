import { describe, expect, it } from "vitest";
import { jsonResult } from "../src/tools/types";

describe("jsonResult", () => {
  it("rejects oversized tool output before it is sent to the MCP client", () => {
    const result = jsonResult("x".repeat(1_000_001));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("1 MB response limit");
  });
});
