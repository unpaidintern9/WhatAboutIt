export interface PowerSaveBlockerLike {
  start: (type: "prevent-app-suspension") => number;
  stop: (id: number) => void;
}

export class RecordingPowerProtection {
  private readonly blockers = new Map<number, number>();

  constructor(private readonly powerSaveBlocker: PowerSaveBlockerLike) {}

  setActive(webContentsId: number, active: boolean) {
    if (active) {
      if (!this.blockers.has(webContentsId)) {
        this.blockers.set(webContentsId, this.powerSaveBlocker.start("prevent-app-suspension"));
      }
      return;
    }
    this.release(webContentsId);
  }

  release(webContentsId: number) {
    const blockerId = this.blockers.get(webContentsId);
    if (blockerId === undefined) return;
    this.blockers.delete(webContentsId);
    this.powerSaveBlocker.stop(blockerId);
  }

  releaseAll() {
    for (const webContentsId of [...this.blockers.keys()]) this.release(webContentsId);
  }
}
