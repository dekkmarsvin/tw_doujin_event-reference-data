import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listJsonFiles, loadBytesByPath, parseReferencePin, sha256 } from "./reference-model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPaths = await listJsonFiles(root, "data");
const dataBytes = await loadBytesByPath(root, dataPaths);
const fixturePrefix = "fixtures/reference-data/";
const fixtureDataPaths = await listJsonFiles(root, "fixtures/reference-data");
const fixtureBytesWithPrefix = await loadBytesByPath(root, fixtureDataPaths);
const fixtureDataBytes = new Map([...fixtureBytesWithPrefix].map(([filePath, bytes]) => [filePath.slice(fixturePrefix.length), bytes]));
const manifestPath = path.join(root, "release-manifest.json");
const generatedAtArgument = process.argv.find((value) => value.startsWith("--generated-at="));
const generatedAt = generatedAtArgument?.slice("--generated-at=".length) ?? new Date().toISOString();
await writeFile(manifestPath, `${JSON.stringify({
  schema: "reference-release-manifest/1",
  generatedAt,
  files: dataPaths.map((filePath) => ({ path: filePath, sha256: sha256(dataBytes.get(filePath)) })),
}, null, 2)}\n`);

const fixturePinPaths = (await listJsonFiles(root, "fixtures/events")).filter((value) => value.endsWith("/reference-data-pin.json"));
for (const pinPath of fixturePinPaths) {
  const absolutePath = path.join(root, pinPath);
  const pin = parseReferencePin(JSON.parse(await readFile(absolutePath, "utf8")));
  const updated = {
    ...pin,
    files: pin.files.map((file) => ({ ...file, sha256: sha256(fixtureDataBytes.get(file.path)) })),
  };
  await writeFile(absolutePath, `${JSON.stringify(updated, null, 2)}\n`);
}

console.log(`Updated ${dataPaths.length} release hashes and ${fixturePinPaths.length} fictional pins from ${fixtureDataPaths.length} fictional data files.`);
