import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepare, publish, verifyConditions } from "./index.js";

async function temporaryPackage(t, packageJson) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pulpo-release-npm-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(path.join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  return root;
}

test("verifyConditions requires a publish token for public packages", async (t) => {
  const cwd = await temporaryPackage(t, { name: "example", version: "1.0.0" });

  await assert.rejects(
    verifyConditions({}, { cwd, env: {} }),
    /NODE_AUTH_TOKEN or NPM_TOKEN is required/
  );
});

test("verifyConditions skips authentication for private packages", async (t) => {
  const cwd = await temporaryPackage(t, { name: "example", private: true, version: "1.0.0" });
  await verifyConditions({}, { cwd, env: {} });
});

test("prepare writes the release version to the selected package root", async (t) => {
  const cwd = await temporaryPackage(t, { name: "example", version: "1.0.0" });
  const context = {
    cwd,
    env: process.env,
    logger: { log() {} },
    nextRelease: { version: "2.3.4" },
    stderr: process.stderr,
    stdout: process.stdout,
  };

  await prepare({}, context);

  const packageJson = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
  assert.equal(packageJson.version, "2.3.4");
});

test("publish skips private packages", async (t) => {
  const cwd = await temporaryPackage(t, { name: "example", private: true, version: "1.0.0" });
  const result = await publish({}, { cwd, env: {}, nextRelease: { version: "1.0.0" } });
  assert.equal(result, false);
});
