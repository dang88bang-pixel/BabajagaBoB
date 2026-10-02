#!/usr/bin/env node
import {appendFileSync} from "node:fs";
import {spawn} from "node:child_process";

const script = process.argv[2];
const supportedScripts = new Set(["test:integration", "test:oci"]);
if (!supportedScripts.has(script)) {
  console.error("Usage: node scripts/ci-vitest-diagnostics.mjs <test:integration|test:oci>");
  process.exit(2);
}

const child = spawn("npm", ["run", script], {
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"]
});
let captured = "";
const maxCapturedCharacters = 120_000;

function forward(stream, chunk) {
  stream.write(chunk);
  captured = (captured + chunk.toString("utf8")).slice(-maxCapturedCharacters);
}

child.stdout.on("data", chunk => forward(process.stdout, chunk));
child.stderr.on("data", chunk => forward(process.stderr, chunk));
child.once("error", error => {
  const message = `Could not start npm run ${script}: ${error.message}\n`;
  process.stderr.write(message);
  captured = (captured + message).slice(-maxCapturedCharacters);
});

const exitCode = await new Promise(resolve => {
  child.once("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
});
if (exitCode === 0) process.exit(0);

// eslint-disable-next-line no-control-regex
const cleanOutput = captured.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replaceAll("\r", "");
const lines = cleanOutput.split("\n");
const excerpt = lines.slice(-100).join("\n").slice(-24_000);
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  const indented = excerpt.split("\n").map(line => `    ${line}`).join("\n");
  appendFileSync(summaryPath, `\n\n## CI diagnostic: npm run ${script} exited ${exitCode}\n\n${indented}\n`);
}

// Keep a concise copy in the check-run annotations API, which remains available
// even when the Actions log archive cannot be downloaded from the runner store.
const annotation = lines.slice(-60).join("\n").slice(-5_000)
  .replace(/%/g, "%25")
  .replace(/\r/g, "%0D")
  .replace(/\n/g, "%0A");
process.stdout.write(`::error title=CI test diagnostics (${script})::${annotation}\n`);
process.exitCode = exitCode;
