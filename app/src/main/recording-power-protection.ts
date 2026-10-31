export interface PowerSaveBlockerLike {
  start: (type: "prevent-display-sleep") => number;
  stop: (id: number) => void;
}

export class RecordingPowerProtection {
  private readonly blockers = new Map<string, { webContentsId: number; activity: "recording" | "studio"; blockerId: number }>();

  constructor(private readonly powerSaveBlocker: PowerSaveBlockerLike) {}

  setActive(webContentsId: number, active: boolean, activity: "recording" | "studio" = "recording") {
    const key = `${webContentsId}:${activity}`;
    if (active) {
      if (!this.blockers.has(key)) {
        this.blockers.set(key, { webContentsId, activity, blockerId: this.powerSaveBlocker.start("prevent-display-sleep") });
      }
      return;
    }
    this.release(webContentsId, activity);
  }

  release(webContentsId: number, activity?: "recording" | "studio") {
    for (const [key, blocker] of this.blockers) {
      if (blocker.webContentsId !== webContentsId || (activity && blocker.activity !== activity)) continue;
      this.blockers.delete(key);
      this.powerSaveBlocker.stop(blocker.blockerId);
    }
  }

  getActive() {
    return [...this.blockers.values()];
  }

  releaseAll() {
    for (const blocker of [...this.blockers.values()]) this.release(blocker.webContentsId);
  }
}
