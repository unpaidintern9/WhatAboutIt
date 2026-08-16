import path from "node:path";
import fs from "node:fs/promises";
import type { AutoEditLearningProfile, AutoEditMode, AutoEditResult } from "../shared/auto-edit";
import { runOfflineAutoEdit } from "../shared/auto-edit";
import type { TimelineDraft } from "../shared/timeline";
import { compactTimelineDraftForPersistence, markTimelineSaved } from "../shared/timeline";
import { getEpisodesRoot } from "./config-service";
import { logger } from "./logger";
import { analyzeEpisodeAudioActivity, analyzeEpisodeSilence } from "./audio-activity-analysis";

function sessionFolder(episodeId: string) {
  return path.join(getEpisodesRoot(), episodeId, "Session");
}

export async function runAutoEdit(input: { episodeId: string; draft: TimelineDraft; mode: AutoEditMode; practice?: boolean; learningProfile?: AutoEditLearningProfile }): Promise<AutoEditResult> {
  const episodeFolder = path.join(getEpisodesRoot(), input.episodeId);
  const activitySegments = input.practice
    ? []
    : await analyzeEpisodeAudioActivity(episodeFolder).catch(async (error) => {
        await logger.warning("AutoEditService", "Microphone activity analysis was unavailable; keeping the existing camera plan.", {
          episodeId: input.episodeId,
          error: String(error)
        });
        return [];
      });
  const silenceSegments = input.practice
    ? []
    : await analyzeEpisodeSilence(episodeFolder).catch(async (error) => {
        await logger.warning("AutoEditService", "Silence analysis was unavailable; no automatic timing cuts were made.", {
          episodeId: input.episodeId,
          error: String(error)
        });
        return [];
      });
  const result = runOfflineAutoEdit({
    draft: input.draft,
    mode: input.mode,
    episodeId: input.episodeId,
    activitySegments,
    silenceSegments,
    learningProfile: input.learningProfile
  });
  const folder = sessionFolder(input.episodeId);
  const savedDraft = markTimelineSaved(result.draft);

  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, "AutoEditReport.json"), JSON.stringify(result.report, null, 2), "utf8");
  await fs.writeFile(path.join(folder, "draft-timeline.json"), JSON.stringify(compactTimelineDraftForPersistence(savedDraft), null, 2), "utf8");
  await logger.info("AutoEditService", "Created local Auto Edit report and draft.", {
    episodeId: input.episodeId,
    mode: input.mode,
    practice: Boolean(input.practice)
  });

  return {
    ...result,
    draft: savedDraft
  };
}
