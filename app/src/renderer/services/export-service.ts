import type { ExportJob, ExportRequest } from "../../shared/export";

export class ExportService {
  constructor(private readonly studio: Window["studio"]) {}

  start(request: ExportRequest): Promise<ExportJob> {
    return this.studio.createExport(request);
  }

  cancel(episodeId: string, job: ExportJob): Promise<ExportJob> {
    return this.studio.cancelExport(episodeId, job);
  }

  openFolder(episodeId: string): Promise<string> {
    return this.studio.openExportFolder(episodeId);
  }
}
