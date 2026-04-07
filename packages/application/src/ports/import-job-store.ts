import type { ImportJob } from "@multi-agent-brain/domain";

export interface ImportJobStore {
  createImportJob(importJob: ImportJob): Promise<ImportJob>;
  getImportJob(importJobId: string): Promise<ImportJob | undefined>;
}
