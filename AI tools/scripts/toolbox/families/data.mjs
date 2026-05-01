import path from "node:path";
import { baseEnvelope } from "../shared/output.mjs";
import { readBoundedTextFile } from "../shared/text.mjs";

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function detectColumnType(values) {
  const presentValues = values.filter((value) => value.trim().length > 0);
  if (presentValues.length === 0) {
    return "empty";
  }
  if (presentValues.every((value) => Number.isFinite(Number(value)))) {
    return "number";
  }
  if (presentValues.every((value) => /^(true|false)$/iu.test(value))) {
    return "boolean";
  }
  if (presentValues.every((value) => !Number.isNaN(Date.parse(value)))) {
    return "date";
  }
  return "string";
}

export async function csvProfile(flags, positional) {
  const filePathArg = positional[0];
  if (!filePathArg) {
    return baseEnvelope("csv-profile", process.cwd(), {}, [], ["Missing CSV file path."]);
  }

  const filePath = path.resolve(filePathArg);
  const text = await readBoundedTextFile(filePath);
  const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return baseEnvelope("csv-profile", path.dirname(filePath), {
      source_path: filePath,
      rows: 0,
      columns: [],
      missing_values: {},
      detected_types: {},
      duplicates: 0
    });
  }

  const columns = parseCsvLine(lines[0]).map((column, index) => column.trim() || `column_${index + 1}`);
  const rows = lines.slice(1).map(parseCsvLine);
  const missingValues = Object.fromEntries(columns.map((column) => [column, 0]));
  const valuesByColumn = Object.fromEntries(columns.map((column) => [column, []]));
  const rowCounts = new Map();

  for (const row of rows) {
    const normalizedRow = columns.map((_, index) => row[index] ?? "");
    const rowKey = JSON.stringify(normalizedRow);
    rowCounts.set(rowKey, (rowCounts.get(rowKey) ?? 0) + 1);
    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index];
      const value = normalizedRow[index].trim();
      if (value.length === 0) {
        missingValues[column] += 1;
      }
      valuesByColumn[column].push(value);
    }
  }

  return baseEnvelope("csv-profile", path.dirname(filePath), {
    source_path: filePath,
    rows: rows.length,
    columns,
    missing_values: missingValues,
    detected_types: Object.fromEntries(columns.map((column) => [column, detectColumnType(valuesByColumn[column])])),
    duplicates: Array.from(rowCounts.values()).reduce((total, count) => total + Math.max(0, count - 1), 0)
  });
}

export const dataCommands = {
  "csv-profile": csvProfile
};
