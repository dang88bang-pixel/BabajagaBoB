#!/usr/bin/env -S npx tsx
/**
 * CLI für den Glyph-Auditor.
 *
 *   npx tsx scripts/audit-font.ts pfad/zu/font.ttf
 *   npx tsx scripts/audit-font.ts font.ttf --json report.json --md report.md
 *   npx tsx scripts/audit-font.ts font.ttf --pixels 128 --min-score 85
 *
 * Exit-Codes: 0 = keine Fehler (und Score ≥ Schwelle), 1 = Fehler gefunden,
 * 2 = Aufruf-/Lesefehler. Damit ist der Auditor in CI und in der
 * Verifikationskette (`npm run verify`) verwendbar.
 */

import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {auditFont, formatAuditMarkdown, type AuditReport} from "../lib/font/audit";
import {SfntError} from "../lib/font/sfnt";

interface CliOptions {
  file: string;
  json?: string;
  md?: string;
  pixelsPerEm: number;
  minScore: number;
  quiet: boolean;
}

function usage(): never {
  console.error(
    [
      "Font-Audit – prüft eine .ttf/.otf auf Geometrie, Metriken, Stil und Features.",
      "",
      "  npx tsx scripts/audit-font.ts <font.ttf> [Optionen]",
      "",
      "Optionen:",
      "  --json <datei>     vollständigen Report als JSON schreiben",
      "  --md <datei>       Markdown-Bericht schreiben",
      "  --pixels <n>       Auflösung der Strichmessung (Pixel pro em, Standard 96)",
      "  --min-score <n>    Mindestscore für Exit-Code 0 (Standard 60)",
      "  --quiet            keinen Markdown-Bericht auf stdout ausgeben"
    ].join("\n")
  );
  process.exit(2);
}

function parseArgs(argv: string[]): CliOptions {
  const rest = argv.slice(2);
  if (rest.length === 0) usage();
  const options: CliOptions = {
    file: "",
    pixelsPerEm: 96,
    minScore: 60,
    quiet: false
  };

  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];
    if (argument === "--json") options.json = rest[++index];
    else if (argument === "--md") options.md = rest[++index];
    else if (argument === "--pixels") options.pixelsPerEm = Number(rest[++index]);
    else if (argument === "--min-score") options.minScore = Number(rest[++index]);
    else if (argument === "--quiet") options.quiet = true;
    else if (argument === "--help" || argument === "-h") usage();
    else if (argument.startsWith("--")) usage();
    else options.file = argument;
  }

  if (!options.file) usage();
  if (!Number.isFinite(options.pixelsPerEm) || options.pixelsPerEm < 16 || options.pixelsPerEm > 512) {
    console.error("--pixels muss zwischen 16 und 512 liegen.");
    process.exit(2);
  }
  return options;
}

function summarize(report: AuditReport): string {
  const errors = report.findings.filter((finding) => finding.severity === "error").length;
  const warnings = report.findings.filter((finding) => finding.severity === "warning").length;
  const infos = report.findings.filter((finding) => finding.severity === "info").length;
  return `${report.verdict} · Score ${report.score.total}/100 · ${errors} Fehler, ${warnings} Warnungen, ${infos} Hinweise`;
}

function main(): void {
  const options = parseArgs(process.argv);
  let buffer: Buffer;
  try {
    buffer = readFileSync(options.file);
  } catch (error) {
    console.error(`Datei nicht lesbar: ${options.file} (${(error as Error).message})`);
    process.exit(2);
  }

  let report: AuditReport;
  try {
    report = auditFont(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
      {pixelsPerEm: options.pixelsPerEm}
    );
  } catch (error) {
    const detail = error instanceof SfntError ? `${error.code}: ${error.message}` : (error as Error).message;
    console.error(`Schrift konnte nicht geparst werden – ${detail}`);
    process.exit(2);
  }

  const markdown = formatAuditMarkdown(report);
  if (!options.quiet) console.log(markdown);
  if (options.md) {
    writeFileSync(options.md, markdown, "utf8");
    console.error(`Markdown-Bericht: ${path.resolve(options.md)}`);
  }
  if (options.json) {
    writeFileSync(options.json, JSON.stringify(report, null, 2), "utf8");
    console.error(`JSON-Report: ${path.resolve(options.json)}`);
  }

  console.error(summarize(report));
  const hasErrors = report.findings.some((finding) => finding.severity === "error");
  process.exit(hasErrors || report.score.total < options.minScore ? 1 : 0);
}

main();
