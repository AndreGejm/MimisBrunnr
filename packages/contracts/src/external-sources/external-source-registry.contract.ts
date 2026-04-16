import type {
  ExternalSourceDocumentContent,
  ExternalSourceDocumentRef,
  ExternalSourceRegistration,
  ExternalSourceType
} from "./external-source.contract.js";

export interface ExternalSourceAdapter {
  getRegistration(): ExternalSourceRegistration;
  listDocuments(): Promise<ExternalSourceDocumentRef[]>;
  readDocument(documentPath: string): Promise<ExternalSourceDocumentContent>;
}

export interface ExternalSourceDefinition {
  sourceType: ExternalSourceType;
  create(registration: ExternalSourceRegistration): ExternalSourceAdapter;
}

export interface ExternalSourceRegistry {
  register(definition: ExternalSourceDefinition): void;
  list(): ExternalSourceDefinition[];
  get(sourceType: ExternalSourceType): ExternalSourceDefinition | undefined;
  create(registration: ExternalSourceRegistration): ExternalSourceAdapter;
}