import type { TimelineDraft } from "../../shared/timeline";

export class TimelineSaveQueue {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly latestSequences = new Map<string, number>();

  constructor(
    private readonly save: (episodeId: string, draft: TimelineDraft) => Promise<TimelineDraft>,
    private readonly applyLatest: (episodeId: string, draft: TimelineDraft) => void
  ) {}

  enqueue(episodeId: string, draft: TimelineDraft) {
    if (draft.episodeId && draft.episodeId !== episodeId) {
      return Promise.reject(new Error(`Refusing to save draft for ${draft.episodeId} into episode ${episodeId}.`));
    }

    const sequence = (this.latestSequences.get(episodeId) ?? 0) + 1;
    this.latestSequences.set(episodeId, sequence);
    const queue = this.queues.get(episodeId) ?? Promise.resolve();
    const task = queue.then(() => this.save(episodeId, { ...draft, episodeId }));
    this.queues.set(
      episodeId,
      task.then(
        () => undefined,
        () => undefined
      )
    );
    return task.then((savedDraft) => {
      if (sequence === this.latestSequences.get(episodeId)) this.applyLatest(episodeId, savedDraft);
      return savedDraft;
    });
  }

  async flush(episodeId?: string) {
    if (episodeId) {
      await this.queues.get(episodeId);
      return;
    }
    await Promise.all(this.queues.values());
  }
}
