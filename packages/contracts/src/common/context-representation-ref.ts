import {
  CONTEXT_REPRESENTATION_LAYERS,
  type ContextRepresentationLayer
} from "@mimir/domain";

export interface ContextRepresentationRef {
  nodeUri: string;
  representationLayer: ContextRepresentationLayer;
  representationUri: string;
  available: boolean;
  selected: boolean;
}

export function parseContextRepresentationRef(
  value: unknown
): ContextRepresentationRef {
  if (!isRecord(value)) {
    throw new TypeError("ContextRepresentationRef must be an object");
  }

  return {
    nodeUri: expectString(value.nodeUri, "ContextRepresentationRef.nodeUri"),
    representationLayer: expectOneOf(
      value.representationLayer,
      CONTEXT_REPRESENTATION_LAYERS,
      "ContextRepresentationRef.representationLayer"
    ),
    representationUri: expectString(
      value.representationUri,
      "ContextRepresentationRef.representationUri"
    ),
    available: expectBoolean(value.available, "ContextRepresentationRef.available"),
    selected: expectBoolean(value.selected, "ContextRepresentationRef.selected")
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }

  return value;
}

function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }

  return value;
}

function expectOneOf<T extends readonly string[]>(
  value: unknown,
  candidates: T,
  label: string
): T[number] {
  if (typeof value !== "string" || !candidates.includes(value)) {
    throw new TypeError(`${label} must be one of: ${candidates.join(", ")}`);
  }

  return value as T[number];
}
