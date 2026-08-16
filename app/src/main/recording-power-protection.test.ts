import { describe, expect, it, vi } from "vitest";
import { RecordingPowerProtection } from "./recording-power-protection";

describe("RecordingPowerProtection", () => {
  it("prevents app suspension once per recording window and releases it after stop", () => {
    const powerSaveBlocker = { start: vi.fn(() => 42), stop: vi.fn() };
    const protection = new RecordingPowerProtection(powerSaveBlocker);

    protection.setActive(7, true);
    protection.setActive(7, true);
    expect(powerSaveBlocker.start).toHaveBeenCalledTimes(1);
    expect(powerSaveBlocker.start).toHaveBeenCalledWith("prevent-app-suspension");

    protection.setActive(7, false);
    expect(powerSaveBlocker.stop).toHaveBeenCalledWith(42);
  });

  it("releases every active blocker during shutdown", () => {
    const powerSaveBlocker = { start: vi.fn().mockReturnValueOnce(11).mockReturnValueOnce(12), stop: vi.fn() };
    const protection = new RecordingPowerProtection(powerSaveBlocker);

    protection.setActive(1, true);
    protection.setActive(2, true);
    protection.releaseAll();

    expect(powerSaveBlocker.stop).toHaveBeenCalledTimes(2);
    expect(powerSaveBlocker.stop).toHaveBeenCalledWith(11);
    expect(powerSaveBlocker.stop).toHaveBeenCalledWith(12);
  });
});
