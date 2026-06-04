// Trivial scaffold test — verifies Vitest is wired correctly.
// Domain tests will be added in subsequent milestones.
import { describe, it, expect } from "vitest";

describe("scaffold", () => {
  it("passes a trivial assertion", () => {
    expect(1 + 1).toBe(2);
  });

  it("confirms the project name", () => {
    const name = "throne";
    expect(name).toMatch(/throne/);
  });
});
