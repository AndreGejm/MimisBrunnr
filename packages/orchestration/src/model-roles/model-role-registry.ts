export type ModelRole =
  | "coding_primary"
  | "coding_advisory"
  | "mimisbrunnr_primary"
  | "embedding_primary"
  | "reranker_primary"
  | "paid_escalation";

export interface ModelRoleBinding {
  role: ModelRole;
  providerId: string;
  modelId?: string;
  fallbackModelIds?: string[];
  temperature: number;
  seed?: number;
  timeoutMs: number;
  maxInputChars?: number;
  maxOutputTokens?: number;
}

export const REQUIRED_MODEL_ROLES: ReadonlyArray<ModelRole> = [
  "coding_primary",
  "coding_advisory",
  "mimisbrunnr_primary",
  "embedding_primary",
  "reranker_primary",
  "paid_escalation"
];

export class ModelRoleRegistry {
  private readonly bindings: Map<ModelRole, ModelRoleBinding>;

  constructor(bindings: Iterable<ModelRoleBinding>) {
    this.bindings = new Map();

    for (const binding of bindings) {
      this.bindings.set(binding.role, Object.freeze({ ...binding }));
    }

    for (const role of REQUIRED_MODEL_ROLES) {
      if (!this.bindings.has(role)) {
        throw new Error(`Missing model-role binding for '${role}'.`);
      }
    }
  }

  resolve(role: ModelRole): ModelRoleBinding {
    const binding = this.bindings.get(role);
    if (!binding) {
      throw new Error(`Model role '${role}' is not configured.`);
    }

    return binding;
  }

  listBindings(): ModelRoleBinding[] {
    return REQUIRED_MODEL_ROLES.map((role) => this.resolve(role));
  }
}
