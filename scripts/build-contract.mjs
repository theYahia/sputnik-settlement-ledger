/**
 * Contract build wrapper.
 *
 * `near-sdk-js build` runs its own typecheck with `--moduleResolution node`,
 * which rejects the explicit `.ts` import specifiers this project needs for
 * Node's native TypeScript execution. So the typecheck is ours (a real
 * tsconfig), and the SDK is driven through its individual build steps:
 * validation, Rollup/babel bundling with the near-bindgen exporter, and the
 * wasm link.
 *
 * The wasm link needs the SDK's bundled wasi-sdk, which the SDK installs for
 * Linux/macOS only. `--bundle-only` stops after the JS bundle and is what a
 * Windows machine can run; the full build runs on Linux (see README).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const source = positional[0] ?? "src/contract/registry.ts";
const target = positional[1] ?? "build/registry.wasm";
const bundleOnly = process.argv.includes("--bundle-only");

function fail(message) {
  console.error(`build-contract: ${message}`);
  process.exit(1);
}

function run(step, args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) fail(`${step} failed`);
}

function main() {
  const tsc = require.resolve("typescript/bin/tsc");
  run("typecheck", [tsc, "-p", "tsconfig.contract.json"]);

  mkdirSync(path.join(root, path.dirname(target)), { recursive: true });
  const sdkCli = require.resolve("near-sdk-js/lib/cli/cli.js");

  run("validate", [sdkCli, "validateContract", source]);
  run("bundle", [sdkCli, "createJsFileWithRollup", source, target]);

  if (bundleOnly) {
    const bundle = path.join(path.dirname(target), `${path.basename(target, ".wasm")}.js`);
    console.log(`build-contract: bundled ${source} -> ${bundle}`);
    return;
  }

  run("wasm", [sdkCli, "transpileJsAndBuildWasm", target]);
  console.log(`build-contract: built ${target}`);
}

main();
