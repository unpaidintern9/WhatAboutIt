import type { ExportJob, ExportRequest, MediaToolsStatus } from "../../shared/export";

export class ExportService {
  constructor(private readonly studio: Window["studio"]) {}

  start(request: ExportRequest): Promise<ExportJob> {
    return this.studio.createExport(request);
  }

  subscribe(listener: (job: ExportJob) => void) {
    return this.studio.onExportProgress?.(listener) ?? (() => undefined);
  }

  mediaToolsStatus(): Promise<MediaToolsStatus> {
    return this.studio.getMediaToolsStatus();
  }

  cancel(episodeId: string, job: ExportJob): Promise<ExportJob> {
    return this.studio.cancelExport(episodeId, job);
  }

  openFolder(episodeId: string): Promise<string> {
    return this.studio.openExportFolder(episodeId);
  }
}
