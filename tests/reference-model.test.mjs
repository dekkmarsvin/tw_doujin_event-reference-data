import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  listJsonFiles,
  loadBytesByPath,
  parseReleaseManifest,
  parseReferencePin,
  validateImmutableRevisionChanges,
  validateReferenceRelationships,
  validateReferenceRecord,
  validateUniqueReferenceIdentities,
  verifyPinAgainstFiles,
} from "../scripts/reference-model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePrefix = "fixtures/reference-data/";
const fixturePaths = await listJsonFiles(root, "fixtures/reference-data");
const prefixedBytes = await loadBytesByPath(root, fixturePaths);
const dataBytes = new Map([...prefixedBytes].map(([filePath, bytes]) => [filePath.slice(fixturePrefix.length), bytes]));
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
const readFixtureJson = (relativePath) => readJson(`${fixturePrefix}${relativePath}`);

test("two fictional events pin one organizer but different catalog revisions", async () => {
  const alpha = await readJson("fixtures/events/event-alpha/reference-data-pin.json");
  const beta = await readJson("fixtures/events/event-beta/reference-data-pin.json");
  assert.equal(alpha.selection.organizer.id, beta.selection.organizer.id);
  assert.notEqual(alpha.commit, beta.commit);
  assert.notEqual(alpha.selection.categoryCatalog.revision, beta.selection.categoryCatalog.revision);
  assert.notEqual(alpha.selection.categoryCatalog.path, beta.selection.categoryCatalog.path);
  assert.equal(verifyPinAgainstFiles(alpha, dataBytes).records.get(alpha.selection.categoryCatalog.path).revision, "2026-01-01");
  assert.equal(verifyPinAgainstFiles(beta, dataBytes).records.get(beta.selection.categoryCatalog.path).revision, "2026-06-01");
});

test("pin parsing fails closed on floating refs, traversal and unlisted selections", async () => {
  const pin = await readJson("fixtures/events/event-alpha/reference-data-pin.json");
  assert.throws(() => parseReferencePin({ ...pin, commit: "main" }), /full commit SHA/);
  assert.throws(() => parseReferencePin({ ...pin, files: [{ path: "../secret.json", sha256: "0".repeat(64) }] }), /path is invalid/);
  assert.throws(() => parseReferencePin({ ...pin, files: pin.files.slice(1) }), /not listed in files/);
});

test("verification rejects hash, schema, stable-id and relationship mismatches", async () => {
  const pin = await readJson("fixtures/events/event-alpha/reference-data-pin.json");
  const badHash = structuredClone(pin);
  badHash.files[0].sha256 = "0".repeat(64);
  assert.throws(() => verifyPinAgainstFiles(badHash, dataBytes), /SHA-256 mismatch/);

  const organizerPath = pin.selection.organizer.path;
  const organizer = JSON.parse(dataBytes.get(organizerPath).toString("utf8"));
  const wrongSchemaFiles = new Map(dataBytes);
  const wrongSchemaBytes = Buffer.from(JSON.stringify({ ...organizer, schema: "organizer/2" }));
  wrongSchemaFiles.set(organizerPath, wrongSchemaBytes);
  const wrongSchemaPin = structuredClone(pin);
  wrongSchemaPin.files.find((file) => file.path === organizerPath).sha256 = (await import("../scripts/reference-model.mjs")).sha256(wrongSchemaBytes);
  assert.throws(() => verifyPinAgainstFiles(wrongSchemaPin, wrongSchemaFiles), /unsupported schema/);

  const unknownId = structuredClone(pin);
  unknownId.selection.organizer.id = "unknown-organizer";
  assert.throws(() => verifyPinAgainstFiles(unknownId, dataBytes), /Unknown organizer stable ID/);

  const wrongVenue = structuredClone(pin);
  wrongVenue.selection.venue.id = "other-venue";
  assert.throws(() => verifyPinAgainstFiles(wrongVenue, dataBytes), /Unknown venue stable ID/);
});

test("every factual field requires official field-level provenance", async () => {
  const catalogPath = "data/category-catalogs/example-organizer/main/2026-06-01.json";
  const catalog = await readFixtureJson(catalogPath);
  delete catalog.provenance["/categories/2/label"];
  assert.throws(() => validateReferenceRecord(catalog, catalogPath), /missing provenance/);
  catalog.provenance["/categories/2/label"] = ["category-page"];
  catalog.sources[0].kind = "community-spreadsheet";
  assert.throws(() => validateReferenceRecord(catalog, catalogPath), /not an allowed official source role/);
});

test("HTTPS values must use the same explicit authority syntax as the schemas", async () => {
  const organizerPath = "data/organizers/example-organizer.json";
  const organizer = await readFixtureJson(organizerPath);
  organizer.officialUrl = "https:organizer.example";
  assert.throws(() => validateReferenceRecord(organizer, organizerPath), /must use HTTPS/);
});

test("timestamps reject nonexistent calendar dates", async () => {
  assert.throws(
    () => parseReleaseManifest({ schema: "reference-release-manifest/1", generatedAt: "2026-02-30T00:00:00Z", files: [] }),
    /must be an ISO timestamp/,
  );
  assert.doesNotThrow(
    () => parseReleaseManifest({ schema: "reference-release-manifest/1", generatedAt: "2024-02-29T23:59:59+08:00", files: [] }),
  );
});

test("published category catalog revisions can only be extended with new files", () => {
  assert.doesNotThrow(() => validateImmutableRevisionChanges(""));
  assert.doesNotThrow(() => validateImmutableRevisionChanges("A\tdata/category-catalogs/example/main/2027-01-01.json"));
  for (const changed of [
    "M\tdata/category-catalogs/example/main/2026-01-01.json",
    "D\tdata/category-catalogs/example/main/2026-01-01.json",
    "R100\tdata/category-catalogs/example/main/2026-01-01.json\tdata/category-catalogs/example/main/2027-01-01.json",
  ]) {
    assert.throws(() => validateImmutableRevisionChanges(changed), /Immutable category catalog revision changed/);
  }
});

test("publisher rejects dangling organizer and venue relationships", async () => {
  const records = [...dataBytes].map(([filePath, bytes]) => validateReferenceRecord(JSON.parse(bytes.toString("utf8")), filePath));
  const orphanCatalog = await readFixtureJson("data/category-catalogs/example-organizer/main/2026-01-01.json");
  orphanCatalog.organizerId = "missing-organizer";
  const parsedOrphanCatalog = validateReferenceRecord(orphanCatalog, "data/category-catalogs/missing-organizer/main/2026-01-01.json");
  assert.throws(() => validateReferenceRelationships([...records, parsedOrphanCatalog]), /unknown organizer/);

  const orphanSpace = await readFixtureJson("data/venue-spaces/example-hall.json");
  orphanSpace.venueId = "missing-venue";
  const parsedOrphanSpace = validateReferenceRecord(orphanSpace, "data/venue-spaces/example-hall.json");
  assert.throws(() => validateReferenceRelationships([...records.filter((record) => record.schema !== "venue-space/1"), parsedOrphanSpace]), /unknown venue/);
});

test("catalog identity is scoped by organizer", async () => {
  const organizer = await readFixtureJson("data/organizers/example-organizer.json");
  const catalog = await readFixtureJson("data/category-catalogs/example-organizer/main/2026-01-01.json");
  const secondOrganizer = validateReferenceRecord({ ...organizer, id: "second-organizer" }, "data/organizers/second-organizer.json");
  const secondCatalog = validateReferenceRecord({ ...catalog, organizerId: "second-organizer" }, "data/category-catalogs/second-organizer/main/2026-01-01.json");
  const firstOrganizer = validateReferenceRecord(organizer, "data/organizers/example-organizer.json");
  const firstCatalog = validateReferenceRecord(catalog, "data/category-catalogs/example-organizer/main/2026-01-01.json");
  assert.doesNotThrow(() => validateUniqueReferenceIdentities([firstOrganizer, firstCatalog, secondOrganizer, secondCatalog]));
  assert.doesNotThrow(() => validateReferenceRelationships([firstOrganizer, firstCatalog, secondOrganizer, secondCatalog]));
});
