import type { TimelineDraft } from "../../shared/timeline";

export class TimelineSaveQueue {
  private queue: Promise<void> = Promise.resolve();
  private latestSequence = 0;

  constructor(
    private readonly save: (episodeId: string, draft: TimelineDraft) => Promise<TimelineDraft>,
    private readonly applyLatest: (draft: TimelineDraft) => void
  ) {}

  enqueue(episodeId: string, draft: TimelineDraft) {
    const sequence = ++this.latestSequence;
    const task = this.queue.then(() => this.save(episodeId, draft));
    this.queue = task.then(
      () => undefined,
      () => undefined
    );
    return task.then((savedDraft) => {
      if (sequence === this.latestSequence) this.applyLatest(savedDraft);
      return savedDraft;
    });
  }
}
