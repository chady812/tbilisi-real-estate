/**
 * Shared JSON primitives for the Facebook payload parsers.
 *
 * Extracted from `fbGraphQLParser.ts` so that module and `fbMediaRules.ts`
 * share one definition of the decoded-JSON shape without importing each other
 * (a value-level import between those two would create a runtime cycle).
 */

/** Recursive shape of arbitrary decoded JSON. */
export type JsonNode = null | boolean | number | string | JsonNode[] | { [key: string]: JsonNode };
/** A decoded JSON object. */
export type JsonRecord = { [key: string]: JsonNode };

/** Narrowing guard for decoded JSON objects. */
export const isRecord = (node: JsonNode): node is JsonRecord =>
  typeof node === 'object' && node !== null && !Array.isArray(node);

/** Narrowing guard for non-empty JSON strings. */
export const isText = (value: JsonNode | undefined): value is string =>
  typeof value === 'string' && value.trim() !== '';
