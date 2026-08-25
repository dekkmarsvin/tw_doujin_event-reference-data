import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const REPOSITORY = "dekkmarsvin/tw_doujin_event-reference-data";
export const PIN_SCHEMA = "reference-data-pin/1";
export const RELEASE_MANIFEST_SCHEMA = "reference-release-manifest/1";

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const EVENT_ID = /^[a-z0-9][a-z0-9-]*$/;
const REVISION = /^[a-z0-9][a-z0-9.-]*$/;
const COMMIT = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
export const DATA_PATH_PATTERN = "^data/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*\\.json$";
const DATA_PATH = new RegExp(DATA_PATH_PATTERN);
const IMMUTABLE_REVISION_PATH = /^data\/category-catalogs\/(?:[^/]+\/){2}[^/]+\.json$/;
const SOURCE_KINDS = new Set(["organizer-official", "venue-official"]);

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function fail(message) {
  throw new Error(message);
}

function requireRecord(value, label) {
  if (!isRecord(value)) fail(`${label} must be an object.`);
  return value;
}

function requireKeys(value, required, allowed, label) {
  for (const key of required) if (!(key in value)) fail(`${label} is missing ${key}.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} has unknown property ${key}.`);
}

function requireString(value, label, pattern) {
  if (typeof value !== "string" || value.trim() === "" || (pattern && !pattern.test(value))) fail(`${label} is invalid.`);
  return value;
}

function normalizeRelative(value, label = "path") {
  requireString(value, label);
  const normalized = value.replaceAll("\\", "/");
  if (normalized !== value || !DATA_PATH.test(value) || value.startsWith("/") || value.split("/").includes("..")) {
    fail(`${label} is invalid.`);
  }
  return normalized;
}

function requireHttpsUrl(value, label) {
  requireString(value, label);
  if (!value.startsWith("https://")) fail(`${label} must use HTTPS.`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} is invalid.`);
  }
  if (parsed.protocol !== "https:") fail(`${label} must use HTTPS.`);
}

function requireTimestamp(value, label) {
  requireString(value, label);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) fail(`${label} must be an ISO timestamp.`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(offsetHourText ?? 0);
  const offsetMinute = Number(offsetMinuteText ?? 0);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]
    || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59
    || Number.isNaN(Date.parse(value))) {
    fail(`${label} must be an ISO timestamp.`);
  }
}

export function validateImmutableRevisionChanges(nameStatusOutput) {
  if (typeof nameStatusOutput !== "string") fail("git revision diff must be text.");
  for (const line of nameStatusOutput.split(/\r?\n/).filter(Boolean)) {
    const [status, ...paths] = line.split("\t");
    const immutablePaths = paths.filter((filePath) => IMMUTABLE_REVISION_PATH.test(filePath));
    if (immutablePaths.length === 0) continue;
    if (status === "A" && paths.length === 1) continue;
    fail(`Immutable category catalog revision changed (${status}): ${immutablePaths.join(", ")}. Publish a new revision instead.`);
  }
}

function validateSources(value, label, allowedKinds = SOURCE_KINDS) {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must list at least one official source.`);
  const ids = new Set();
  for (const [index, sourceValue] of value.entries()) {
    const source = requireRecord(sourceValue, `${label}[${index}]`);
    requireKeys(source, ["id", "kind", "url", "retrievedAt"], ["id", "kind", "url", "retrievedAt", "note"], `${label}[${index}]`);
    requireString(source.id, `${label}[${index}].id`, ID);
    if (ids.has(source.id)) fail(`${label} has duplicate source id ${source.id}.`);
    ids.add(source.id);
    if (!allowedKinds.has(source.kind)) fail(`${label}[${index}].kind is not an allowed official source role.`);
    requireHttpsUrl(source.url, `${label}[${index}].url`);
    requireTimestamp(source.retrievedAt, `${label}[${index}].retrievedAt`);
    if (source.note !== undefined) requireString(source.note, `${label}[${index}].note`);
  }
  return ids;
}

function validateProvenance(value, sourceIds, requiredPointers, label) {
  const provenance = requireRecord(value, label);
  if (Object.keys(provenance).length === 0) fail(`${label} must not be empty.`);
  for (const [pointer, references] of Object.entries(provenance)) {
    if (!pointer.startsWith("/")) fail(`${label} key ${pointer} is not a JSON Pointer.`);
    if (!Array.isArray(references) || references.length === 0) fail(`${label}.${pointer} must reference a source.`);
    if (new Set(references).size !== references.length) fail(`${label}.${pointer} has duplicate source ids.`);
    for (const sourceId of references) if (!sourceIds.has(sourceId)) fail(`${label}.${pointer} references unknown source ${sourceId}.`);
  }
  for (const pointer of requiredPointers) if (!(pointer in provenance)) fail(`${label} is missing provenance for ${pointer}.`);
}

function expectRecordPath(actualPath, expectedPath, label) {
  if (actualPath && actualPath !== expectedPath) fail(`${label} must live at ${expectedPath}, got ${actualPath}.`);
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateReferenceRecord(value, relativePath = "") {
  const record = requireRecord(value, relativePath || "record");
  requireString(record.schema, `${relativePath}.schema`);

  if (record.schema === "organizer/1") {
    requireKeys(record, ["schema", "id", "name", "officialUrl", "sources", "provenance"], ["schema", "id", "name", "officialUrl", "sources", "provenance"], relativePath);
    requireString(record.id, `${relativePath}.id`, ID);
    requireString(record.name, `${relativePath}.name`);
    requireHttpsUrl(record.officialUrl, `${relativePath}.officialUrl`);
    const sourceIds = validateSources(record.sources, `${relativePath}.sources`, new Set(["organizer-official"]));
    validateProvenance(record.provenance, sourceIds, ["/name", "/officialUrl"], `${relativePath}.provenance`);
    expectRecordPath(relativePath, `data/organizers/${record.id}.json`, "Organizer record");
    return record;
  }

  if (record.schema === "category-catalog/1") {
    requireKeys(record, ["schema", "id", "organizerId", "revision", "categories", "sources", "provenance"], ["schema", "id", "organizerId", "revision", "categories", "sources", "provenance"], relativePath);
    requireString(record.id, `${relativePath}.id`, ID);
    requireString(record.organizerId, `${relativePath}.organizerId`, ID);
    requireString(record.revision, `${relativePath}.revision`, REVISION);
    if (!Array.isArray(record.categories) || record.categories.length === 0) fail(`${relativePath}.categories must not be empty.`);
    const categoryIds = new Set();
    const requiredPointers = [];
    for (const [index, categoryValue] of record.categories.entries()) {
      const category = requireRecord(categoryValue, `${relativePath}.categories[${index}]`);
      requireKeys(category, ["id", "label"], ["id", "label", "description"], `${relativePath}.categories[${index}]`);
      requireString(category.id, `${relativePath}.categories[${index}].id`, ID);
      requireString(category.label, `${relativePath}.categories[${index}].label`);
      if (categoryIds.has(category.id)) fail(`${relativePath} has duplicate category id ${category.id}.`);
      categoryIds.add(category.id);
      requiredPointers.push(`/categories/${index}/label`);
      if (category.description !== undefined) {
        requireString(category.description, `${relativePath}.categories[${index}].description`);
        requiredPointers.push(`/categories/${index}/description`);
      }
    }
    const sourceIds = validateSources(record.sources, `${relativePath}.sources`, new Set(["organizer-official"]));
    validateProvenance(record.provenance, sourceIds, requiredPointers, `${relativePath}.provenance`);
    expectRecordPath(relativePath, `data/category-catalogs/${record.organizerId}/${record.id}/${record.revision}.json`, "Category catalog");
    return record;
  }

  if (record.schema === "venue/1") {
    requireKeys(record, ["schema", "id", "name", "officialUrl", "sources", "provenance"], ["schema", "id", "name", "officialUrl", "sources", "provenance"], relativePath);
    requireString(record.id, `${relativePath}.id`, ID);
    requireString(record.name, `${relativePath}.name`);
    requireHttpsUrl(record.officialUrl, `${relativePath}.officialUrl`);
    const sourceIds = validateSources(record.sources, `${relativePath}.sources`);
    validateProvenance(record.provenance, sourceIds, ["/name", "/officialUrl"], `${relativePath}.provenance`);
    expectRecordPath(relativePath, `data/venues/${record.id}.json`, "Venue record");
    return record;
  }

  if (record.schema === "venue-space/1") {
    requireKeys(record, ["schema", "id", "venueId", "name", "sources", "provenance"], ["schema", "id", "venueId", "name", "sources", "provenance"], relativePath);
    requireString(record.id, `${relativePath}.id`, ID);
    requireString(record.venueId, `${relativePath}.venueId`, ID);
    requireString(record.name, `${relativePath}.name`);
    const sourceIds = validateSources(record.sources, `${relativePath}.sources`);
    validateProvenance(record.provenance, sourceIds, ["/name"], `${relativePath}.provenance`);
    expectRecordPath(relativePath, `data/venue-spaces/${record.id}.json`, "Venue-space record");
    return record;
  }

  fail(`${relativePath || "record"} uses unsupported schema ${record.schema}.`);
}

export function referenceIdentity(record) {
  return record.schema === "category-catalog/1"
    ? `${record.schema}:${record.organizerId}:${record.id}:${record.revision}`
    : `${record.schema}:${record.id}`;
}

export function validateUniqueReferenceIdentities(records) {
  const identities = new Set();
  for (const record of records) {
    const identity = referenceIdentity(record);
    if (identities.has(identity)) fail(`Duplicate stable identity ${identity}.`);
    identities.add(identity);
  }
}

export function validateReferenceRelationships(records) {
  const values = [...records];
  const organizerIds = new Set(values.filter((record) => record.schema === "organizer/1").map((record) => record.id));
  const venueIds = new Set(values.filter((record) => record.schema === "venue/1").map((record) => record.id));
  for (const record of values) {
    if (record.schema === "category-catalog/1" && !organizerIds.has(record.organizerId)) {
      fail(`Category catalog ${record.organizerId}/${record.id}@${record.revision} references unknown organizer ${record.organizerId}.`);
    }
    if (record.schema === "venue-space/1" && !venueIds.has(record.venueId)) {
      fail(`Venue-space ${record.id} references unknown venue ${record.venueId}.`);
    }
  }
}

function validateIdPath(value, label, extra = false) {
  const entry = requireRecord(value, label);
  const required = extra ? ["id", "organizerId", "revision", "path"] : ["id", "path"];
  requireKeys(entry, required, required, label);
  requireString(entry.id, `${label}.id`, ID);
  normalizeRelative(entry.path, `${label}.path`);
  if (extra) {
    requireString(entry.organizerId, `${label}.organizerId`, ID);
    requireString(entry.revision, `${label}.revision`, REVISION);
  }
  return entry;
}

export function parseReferencePin(value) {
  const pin = requireRecord(value, "reference pin");
  requireKeys(pin, ["schema", "eventId", "repository", "commit", "files", "selection"], ["schema", "eventId", "repository", "commit", "files", "selection"], "reference pin");
  if (pin.schema !== PIN_SCHEMA) fail("Unsupported reference data pin schema.");
  requireString(pin.eventId, "reference pin eventId", EVENT_ID);
  if (pin.repository !== REPOSITORY) fail(`Reference pin repository must be ${REPOSITORY}.`);
  requireString(pin.commit, "Reference pin full commit SHA", COMMIT);
  if (!Array.isArray(pin.files) || pin.files.length === 0) fail("Reference pin must list files.");
  const filePaths = new Set();
  for (const [index, fileValue] of pin.files.entries()) {
    const file = requireRecord(fileValue, `reference pin files[${index}]`);
    requireKeys(file, ["path", "sha256"], ["path", "sha256"], `reference pin files[${index}]`);
    normalizeRelative(file.path, `reference pin files[${index}].path`);
    requireString(file.sha256, `reference pin files[${index}].sha256`, HASH);
    if (filePaths.has(file.path)) fail(`Reference pin has duplicate path ${file.path}.`);
    filePaths.add(file.path);
  }

  const selection = requireRecord(pin.selection, "reference pin selection");
  requireKeys(selection, ["organizer", "categoryCatalog", "venue", "venueSpaces"], ["organizer", "categoryCatalog", "venue", "venueSpaces"], "reference pin selection");
  validateIdPath(selection.organizer, "reference pin organizer");
  validateIdPath(selection.categoryCatalog, "reference pin categoryCatalog", true);
  validateIdPath(selection.venue, "reference pin venue");
  if (!Array.isArray(selection.venueSpaces) || selection.venueSpaces.length === 0) fail("Reference pin must select at least one venue space.");
  const spaceIds = new Set();
  for (const [index, space] of selection.venueSpaces.entries()) {
    const parsed = validateIdPath(space, `reference pin venueSpaces[${index}]`);
    if (spaceIds.has(parsed.id)) fail(`Reference pin has duplicate venue-space id ${parsed.id}.`);
    spaceIds.add(parsed.id);
  }
  for (const selected of [selection.organizer, selection.categoryCatalog, selection.venue, ...selection.venueSpaces]) {
    if (!filePaths.has(selected.path)) fail(`Reference pin selection path ${selected.path} is not listed in files.`);
  }
  return pin;
}

export function verifyPinAgainstFiles(value, filesByPath) {
  const pin = parseReferencePin(value);
  const records = new Map();
  for (const file of pin.files) {
    const bytes = filesByPath.get(file.path);
    if (!bytes) fail(`Pinned file is missing: ${file.path}.`);
    const actual = sha256(bytes);
    if (actual !== file.sha256) fail(`SHA-256 mismatch for ${file.path}: expected ${file.sha256}, got ${actual}.`);
    let json;
    try {
      json = JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
      fail(`Pinned file is not valid JSON: ${file.path}.`);
    }
    records.set(file.path, validateReferenceRecord(json, file.path));
  }

  const { organizer, categoryCatalog, venue, venueSpaces } = pin.selection;
  const organizerRecord = records.get(organizer.path);
  const catalogRecord = records.get(categoryCatalog.path);
  const venueRecord = records.get(venue.path);
  if (organizerRecord?.schema !== "organizer/1" || organizerRecord.id !== organizer.id) fail(`Unknown organizer stable ID ${organizer.id}.`);
  if (catalogRecord?.schema !== "category-catalog/1" || catalogRecord.id !== categoryCatalog.id
    || catalogRecord.organizerId !== categoryCatalog.organizerId || catalogRecord.revision !== categoryCatalog.revision) {
    fail(`Unknown category catalog ${categoryCatalog.organizerId}/${categoryCatalog.id}@${categoryCatalog.revision}.`);
  }
  if (catalogRecord.organizerId !== organizerRecord.id) fail("Selected category catalog does not belong to the selected organizer.");
  if (venueRecord?.schema !== "venue/1" || venueRecord.id !== venue.id) fail(`Unknown venue stable ID ${venue.id}.`);
  for (const selectedSpace of venueSpaces) {
    const spaceRecord = records.get(selectedSpace.path);
    if (spaceRecord?.schema !== "venue-space/1" || spaceRecord.id !== selectedSpace.id) fail(`Unknown venue-space stable ID ${selectedSpace.id}.`);
    if (spaceRecord.venueId !== venueRecord.id) fail(`Venue-space ${selectedSpace.id} does not belong to venue ${venueRecord.id}.`);
  }
  return { pin, records };
}

export function parseReleaseManifest(value) {
  const manifest = requireRecord(value, "release manifest");
  requireKeys(manifest, ["schema", "generatedAt", "files"], ["schema", "generatedAt", "files"], "release manifest");
  if (manifest.schema !== RELEASE_MANIFEST_SCHEMA) fail("Unsupported release manifest schema.");
  requireTimestamp(manifest.generatedAt, "release manifest generatedAt");
  if (!Array.isArray(manifest.files)) fail("Release manifest files must be an array.");
  const paths = new Set();
  for (const [index, fileValue] of manifest.files.entries()) {
    const file = requireRecord(fileValue, `release manifest files[${index}]`);
    requireKeys(file, ["path", "sha256"], ["path", "sha256"], `release manifest files[${index}]`);
    normalizeRelative(file.path, `release manifest files[${index}].path`);
    requireString(file.sha256, `release manifest files[${index}].sha256`, HASH);
    if (paths.has(file.path)) fail(`Release manifest has duplicate path ${file.path}.`);
    paths.add(file.path);
  }
  return manifest;
}

export async function listJsonFiles(root, relativeDirectory) {
  const result = [];
  async function visit(relative) {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries) {
      const child = path.posix.join(relative.replaceAll("\\", "/"), entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && entry.name.endsWith(".json")) result.push(child);
    }
  }
  await visit(relativeDirectory);
  return result.sort();
}

export async function loadBytesByPath(root, relativePaths) {
  return new Map(await Promise.all(relativePaths.map(async (relativePath) => [relativePath, await readFile(path.join(root, relativePath))])));
}
