import type { ImportJob } from "@mimir/domain";

export interface ImportJobStore {
  createImportJob(importJob: ImportJob): Promise<ImportJob>;
  getImportJob(importJobId: string): Promise<ImportJob | undefined>;
}
