import path from "node:path";
import fs from "node:fs/promises";
import {
  autoEditStageLabels,
  type AutoEditLearningProfile,
  type AutoEditMode,
  type AutoEditProgress,
  type AutoEditResult,
  type AutoEditStageId,
} from "../shared/auto-edit";
import { runOfflineAutoEdit } from "../shared/auto-edit";
import type { TimelineDraft } from "../shared/timeline";
import {
  markTimelineSaved,
  prepareTimelineDraftForStorage,
} from "../shared/timeline";
import { getEpisodesRoot } from "./config-service";
import { logger } from "./logger";
import {
  analyzeEpisodeAudioActivity,
  analyzeEpisodeSilence,
} from "./audio-activity-analysis";

function sessionFolder(episodeId: string) {
  return path.join(getEpisodesRoot(), episodeId, "Session");
}

const activeAutoEdits = new Map<string, AbortController>();

export async function runAutoEdit(
  input: {
    episodeId: string;
    draft: TimelineDraft;
    mode: AutoEditMode;
    practice?: boolean;
    learningProfile?: AutoEditLearningProfile;
  },
  onProgress?: (progress: AutoEditProgress) => void,
): Promise<AutoEditResult> {
  if (activeAutoEdits.has(input.episodeId))
    throw new Error("Auto Edit is already running for this episode.");
  const controller = new AbortController();
  activeAutoEdits.set(input.episodeId, controller);
  const report = (
    stage: AutoEditStageId,
    progress: number,
    message = autoEditStageLabels[stage],
  ) => onProgress?.({ episodeId: input.episodeId, stage, progress, message });
  const episodeFolder = path.join(getEpisodesRoot(), input.episodeId);
  try {
    report("recording", 4);
    const activitySegments = input.practice
      ? []
      : await analyzeEpisodeAudioActivity(
          episodeFolder,
          controller.signal,
        ).catch(async (error) => {
          if ((error as Error)?.name === "AbortError") throw error;
          await logger.warning(
            "AutoEditService",
            "Microphone activity analysis was unavailable; keeping the existing camera plan.",
            {
              episodeId: input.episodeId,
              error: String(error),
            },
          );
          return [];
        });
    report("speaker-detection", 42);
    const silenceSegments = input.practice
      ? []
      : await analyzeEpisodeSilence(episodeFolder, controller.signal).catch(
          async (error) => {
            if ((error as Error)?.name === "AbortError") throw error;
            await logger.warning(
              "AutoEditService",
              "Silence analysis was unavailable; no automatic timing cuts were made.",
              {
                episodeId: input.episodeId,
                error: String(error),
              },
            );
            return [];
          },
        );
    if (controller.signal.aborted) {
      const error = new Error(
        "Auto Edit was canceled. Your existing draft is unchanged.",
      );
      error.name = "AbortError";
      throw error;
    }
    report("timeline-decisions", 72);
    const result = runOfflineAutoEdit({
      draft: input.draft,
      mode: input.mode,
      episodeId: input.episodeId,
      activitySegments,
      silenceSegments,
      learningProfile: input.learningProfile,
    });
    const folder = sessionFolder(input.episodeId);
    const savedDraft = markTimelineSaved(result.draft);

    report("draft-timeline", 88);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(folder, "AutoEditReport.json"),
      JSON.stringify(result.report, null, 2),
      "utf8",
    );
    await fs.writeFile(
      path.join(folder, "draft-timeline.json"),
      JSON.stringify(prepareTimelineDraftForStorage(savedDraft), null, 2),
      "utf8",
    );
    await logger.info(
      "AutoEditService",
      "Created local Auto Edit report and draft.",
      {
        episodeId: input.episodeId,
        mode: input.mode,
        practice: Boolean(input.practice),
      },
    );

    report("export-ready", 100, "Auto Edit draft is ready to review");
    return { ...result, draft: savedDraft };
  } finally {
    if (activeAutoEdits.get(input.episodeId) === controller)
      activeAutoEdits.delete(input.episodeId);
  }
}

export function cancelAutoEdit(episodeId: string) {
  const active = activeAutoEdits.get(episodeId);
  if (!active) return false;
  active.abort();
  return true;
}
