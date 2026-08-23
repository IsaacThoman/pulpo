import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

// The upstream plugin installs a second, bundled npm CLI. Using the runner's
// npm keeps release behavior aligned with the rest of CI and avoids carrying a
// separate vulnerable npm dependency tree in the application lockfile.
function packageRoot(pluginConfig, cwd) {
  return pluginConfig.pkgRoot ? path.resolve(cwd, pluginConfig.pkgRoot) : cwd;
}

async function readPackage(pluginConfig, cwd) {
  const root = packageRoot(pluginConfig, cwd);
  const contents = await readFile(path.join(root, "package.json"), "utf8");
  return { packageJson: JSON.parse(contents), root };
}

function runNpm(args, { cwd, env, stdout, stderr }) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.pipe(stdout, { end: false });
    child.stderr.pipe(stderr, { end: false });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`npm ${args[0]} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`));
    });
  });
}

export async function verifyConditions(pluginConfig, context) {
  const { packageJson } = await readPackage(pluginConfig, context.cwd);
  if (pluginConfig.npmPublish === false || packageJson.private === true) return;

  if (!context.env.NODE_AUTH_TOKEN && !context.env.NPM_TOKEN) {
    throw new Error("NODE_AUTH_TOKEN or NPM_TOKEN is required to publish the npm package");
  }
}

export async function prepare(pluginConfig, context) {
  const { root } = await readPackage(pluginConfig, context.cwd);
  const version = context.nextRelease.version;

  context.logger.log("Write version %s to package.json in %s", version, root);
  await runNpm(
    ["version", version, "--no-git-tag-version", "--allow-same-version"],
    { ...context, cwd: root }
  );
}

export async function publish(pluginConfig, context) {
  const { packageJson, root } = await readPackage(pluginConfig, context.cwd);
  if (pluginConfig.npmPublish === false || packageJson.private === true) return false;

  const distTag = context.nextRelease.channel || "latest";
  const registry =
    packageJson.publishConfig?.registry || context.env.NPM_CONFIG_REGISTRY || "https://registry.npmjs.org/";

  context.logger.log("Publishing version %s to npm on dist-tag %s", context.nextRelease.version, distTag);
  await runNpm(
    ["publish", "--tag", distTag, "--registry", registry],
    { ...context, cwd: root }
  );

  return {
    name: `npm package (@${distTag} dist-tag)`,
    url:
      registry.replace(/\/$/, "") === "https://registry.npmjs.org"
        ? `https://www.npmjs.com/package/${packageJson.name}/v/${context.nextRelease.version}`
        : undefined,
    channel: distTag,
  };
}
