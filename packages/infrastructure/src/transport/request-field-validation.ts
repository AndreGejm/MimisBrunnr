import { TransportValidationError } from "./transport-validation-error.js";

export type JsonRecord = Record<string, unknown>;

export type IntegerValidationOptions = {
  min?: number;
};

export type EnumValidationOptions = {
  aliases?: ReadonlyMap<string, string>;
};

export type EnumArrayValidationOptions = EnumValidationOptions & {
  minItems?: number;
};

export function requireObject(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw requestValidationError(field, "must be a JSON object");
  }

  return value as JsonRecord;
}

export function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw requestValidationError(field, "must be an array");
  }

  return value;
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw requestValidationError(field, "must be a non-empty string");
  }

  return value;
}

export function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireString(value, field);
}

export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw requestValidationError(field, "must be a boolean");
  }

  return value;
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireBoolean(value, field);
}

export function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw requestValidationError(field, "must be a finite number");
  }

  return value;
}

export function requireInteger(
  value: unknown,
  field: string,
  options: IntegerValidationOptions = {}
): number {
  const numberValue = requireNumber(value, field);
  if (!Number.isInteger(numberValue)) {
    throw requestValidationError(field, "must be an integer");
  }

  if (options.min !== undefined && numberValue < options.min) {
    throw requestValidationError(field, `must be greater than or equal to ${options.min}`);
  }

  return numberValue;
}

export function optionalInteger(
  value: unknown,
  field: string,
  options: IntegerValidationOptions = {}
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireInteger(value, field, options);
}

export function requireEnum<T extends string>(
  value: unknown,
  field: string,
  allowedValues: ReadonlySet<T>,
  options: EnumValidationOptions = {}
): T {
  const stringValue = normalizeEnumValue(requireString(value, field), options);
  if (!allowedValues.has(stringValue as T)) {
    throw requestValidationError(field, `must be one of: ${[...allowedValues].join(", ")}`);
  }

  return stringValue as T;
}

export function optionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowedValues: ReadonlySet<T>,
  options: EnumValidationOptions = {}
): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireEnum(value, field, allowedValues, options);
}

export function requireStringArray(
  value: unknown,
  field: string
): string[] {
  const values = requireArray(value, field);
  return values.map((item, index) => requireString(item, `${field}[${index}]`));
}

export function optionalStringArray(
  value: unknown,
  field: string
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireStringArray(value, field);
}

export function requireEnumArray<T extends string>(
  value: unknown,
  field: string,
  allowedValues: ReadonlySet<T>,
  options: EnumArrayValidationOptions = {}
): T[] {
  const values = requireArray(value, field);
  if (options.minItems !== undefined && values.length < options.minItems) {
    throw requestValidationError(field, `must contain at least ${options.minItems} item(s)`);
  }

  return values.map((item, index) =>
    requireEnum(item, `${field}[${index}]`, allowedValues, options)
  );
}

export function optionalEnumArray<T extends string>(
  value: unknown,
  field: string,
  allowedValues: ReadonlySet<T>,
  options: EnumValidationOptions = {}
): T[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireEnumArray(value, field, allowedValues, options);
}

export function requestValidationError(field: string, problem: string): TransportValidationError {
  return new TransportValidationError(
    `Invalid request field '${field}': ${problem}.`,
    { field, problem }
  );
}

function normalizeEnumValue(
  value: string,
  options: EnumValidationOptions
): string {
  if (options.aliases) {
    return options.aliases.get(value.trim().toLowerCase()) ?? value;
  }

  return value;
}