import type {
  ExternalSourceAdapter,
  ExternalSourceDefinition,
  ExternalSourceRegistration,
  ExternalSourceRegistry,
  ExternalSourceType
} from "@mimir/contracts";
import { ObsidianVaultSource } from "./obsidian-vault-source.js";

export class InMemoryExternalSourceRegistry implements ExternalSourceRegistry {
  private readonly definitions = new Map<ExternalSourceType, ExternalSourceDefinition>();

  register(definition: ExternalSourceDefinition): void {
    if (this.definitions.has(definition.sourceType)) {
      throw new Error(
        `External source adapter '${definition.sourceType}' is already registered.`
      );
    }

    this.definitions.set(definition.sourceType, definition);
  }

  list(): ExternalSourceDefinition[] {
    return [...this.definitions.values()];
  }

  get(sourceType: ExternalSourceType): ExternalSourceDefinition | undefined {
    return this.definitions.get(sourceType);
  }

  create(registration: ExternalSourceRegistration): ExternalSourceAdapter {
    const definition = this.get(registration.sourceType);
    if (!definition) {
      throw new Error(
        `No external source adapter is registered for source type '${registration.sourceType}'.`
      );
    }

    return definition.create(registration);
  }
}

export function buildDefaultExternalSourceRegistry(): ExternalSourceRegistry {
  const registry = new InMemoryExternalSourceRegistry();
  registry.register({
    sourceType: "obsidian_vault",
    create: (registration) => new ObsidianVaultSource(registration)
  });
  return registry;
}