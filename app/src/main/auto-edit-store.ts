import path from "node:path";
import fs from "node:fs/promises";
import type { AutoEditMode, AutoEditResult } from "../shared/auto-edit";
import { runOfflineAutoEdit } from "../shared/auto-edit";
import type { TimelineDraft } from "../shared/timeline";
import { markTimelineSaved } from "../shared/timeline";
import { getEpisodesRoot } from "./config-service";
import { logger } from "./logger";

function sessionFolder(episodeId: string) {
  return path.join(getEpisodesRoot(), episodeId, "Session");
}

export async function runAutoEdit(input: {
  episodeId: string;
  draft: TimelineDraft;
  mode: AutoEditMode;
  practice?: boolean;
}): Promise<AutoEditResult> {
  const result = runOfflineAutoEdit({
    draft: input.draft,
    mode: input.mode,
    episodeId: input.episodeId
  });
  const folder = sessionFolder(input.episodeId);
  const savedDraft = markTimelineSaved(result.draft);

  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, "AutoEditReport.json"), JSON.stringify(result.report, null, 2), "utf8");
  await fs.writeFile(path.join(folder, "draft-timeline.json"), JSON.stringify(savedDraft, null, 2), "utf8");
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
