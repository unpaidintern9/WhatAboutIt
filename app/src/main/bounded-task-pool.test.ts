import { describe, expect, it } from "vitest";
import { runBoundedTasks } from "./bounded-task-pool";

describe("runBoundedTasks", () => {
  it("preserves result order while limiting concurrent transfers", async () => {
    let active = 0;
    let maximumActive = 0;
    const results = await runBoundedTasks([1, 2, 3, 4, 5, 6], 3, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, value % 2 === 0 ? 2 : 5));
      active -= 1;
      return value * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50, 60]);
    expect(maximumActive).toBe(3);
  });

  it("stops scheduling new transfers after the first failure", async () => {
    const started: number[] = [];
    await expect(runBoundedTasks([1, 2, 3, 4, 5], 2, async (value) => {
      started.push(value);
      if (value === 2) throw new Error("download failed");
      await new Promise((resolve) => setTimeout(resolve, 5));
      return value;
    })).rejects.toThrow("download failed");

    expect(started).toEqual([1, 2]);
  });
});
