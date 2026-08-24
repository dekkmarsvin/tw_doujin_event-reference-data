import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DATA_PATH_PATTERN,
  listJsonFiles,
  loadBytesByPath,
  parseReferencePin,
  parseReleaseManifest,
  sha256,
  validateReferenceRelationships,
  validateReferenceRecord,
  validateUniqueReferenceIdentities,
  verifyPinAgainstFiles,
} from "./reference-model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const schemaPaths = await listJsonFiles(root, "schemas");
const schemas = new Map();
for (const schemaPath of schemaPaths) {
  const schema = JSON.parse(await readFile(path.join(root, schemaPath), "utf8"));
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema" || typeof schema.$id !== "string") {
    throw new Error(`${schemaPath} is not a versioned draft 2020-12 JSON Schema.`);
  }
  schemas.set(schemaPath, schema);
}
const pinSchema = schemas.get("schemas/v1/reference-pin.schema.json");
const releaseSchema = schemas.get("schemas/v1/release-manifest.schema.json");
const schemaPathPatterns = [
  pinSchema.properties.files.items.properties.path.pattern,
  pinSchema.properties.selection.properties.categoryCatalog.properties.path.pattern,
  pinSchema.$defs.idPath.properties.path.pattern,
  releaseSchema.properties.files.items.properties.path.pattern,
];
if (!schemaPathPatterns.every((pattern) => pattern === DATA_PATH_PATTERN)) {
  throw new Error("JSON Schema and validator data path contracts must be identical.");
}

const dataPaths = await listJsonFiles(root, "data");
const dataBytes = await loadBytesByPath(root, dataPaths);
const records = [];
for (const dataPath of dataPaths) {
  const record = validateReferenceRecord(JSON.parse(dataBytes.get(dataPath).toString("utf8")), dataPath);
  records.push(record);
}
validateUniqueReferenceIdentities(records);
validateReferenceRelationships(records);

const manifest = parseReleaseManifest(JSON.parse(await readFile(path.join(root, "release-manifest.json"), "utf8")));
if (JSON.stringify(manifest.files.map((file) => file.path)) !== JSON.stringify(dataPaths)) {
  throw new Error("release-manifest.json must list every data file exactly once in sorted order.");
}
for (const file of manifest.files) {
  const actual = sha256(dataBytes.get(file.path));
  if (actual !== file.sha256) throw new Error(`Release manifest hash mismatch for ${file.path}.`);
}

const fixturePrefix = "fixtures/reference-data/";
const fixtureDataPaths = await listJsonFiles(root, "fixtures/reference-data");
const fixtureBytesWithPrefix = await loadBytesByPath(root, fixtureDataPaths);
const fixtureDataBytes = new Map([...fixtureBytesWithPrefix].map(([filePath, bytes]) => [filePath.slice(fixturePrefix.length), bytes]));
const fixtureRecords = [...fixtureDataBytes].map(([filePath, bytes]) => validateReferenceRecord(JSON.parse(bytes.toString("utf8")), filePath));
validateUniqueReferenceIdentities(fixtureRecords);
validateReferenceRelationships(fixtureRecords);
const fixturePinPaths = (await listJsonFiles(root, "fixtures/events")).filter((value) => value.endsWith("/reference-data-pin.json"));
for (const pinPath of fixturePinPaths) {
  const pin = parseReferencePin(JSON.parse(await readFile(path.join(root, pinPath), "utf8")));
  verifyPinAgainstFiles(pin, fixtureDataBytes);
}

console.log(`Validated ${schemaPaths.length} schemas, ${dataPaths.length} published data files, ${fixtureDataPaths.length} fictional data files, and ${fixturePinPaths.length} fictional event pins.`);
