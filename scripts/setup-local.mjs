#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const envFile = path.join(root, ".env.local");
const storageDir = process.env.BOB_STORAGE_DIR ?? ".bob-data";

function randomSecret() {
  return crypto.randomBytes(24).toString("base64url");
}

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map(line => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map(match => [match[1], match[2]])
  );
}

const current = readEnv(envFile);
const bootstrapSecret = current.BOB_BOOTSTRAP_SECRET || randomSecret();
const runtime = current.BOB_SANDBOX_RUNTIME || "local";

const lines = [
  "# BabajagaBoB – lokale Entwicklungsumgebung",
  "# Diese Datei ist lokal und darf niemals committed werden.",
  `BOB_STORAGE_DIR=${storageDir}`,
  `BOB_SANDBOX_RUNTIME=${runtime}`,
  `BOB_BOOTSTRAP_SECRET=${bootstrapSecret}`,
  ""
];

fs.writeFileSync(envFile, lines.join("\n"), {mode: 0o600});

console.log("");
console.log("BabajagaBoB – lokale Umgebung vorbereitet.");
console.log("");
console.log("1. Starte:");
console.log("   npm run dev");
console.log("");
console.log("2. Öffne:");
console.log("   http://localhost:3000");
console.log("");
console.log("3. Beim ersten Start im Creator-Bootstrap dieses Secret verwenden:");
console.log(`   ${bootstrapSecret}`);
console.log("");
console.log("Nach erfolgreichem Bootstrap wird ein serverseitiges Creator-Login-Secret unter");
console.log(`   ${path.join(storageDir, "creator-token")}`);
console.log("erzeugt (0600). Das Secret wird nicht an den Browser ausgeliefert.");
console.log("");
console.log("Hinweis: Diese lokale Konfiguration verwendet die verifizierte lokale Runtime.");
console.log("Für echte OCI-Ausführung muss BOB_SANDBOX_RUNTIME=oci gesetzt und ein OCI-Daemon vorhanden sein.");
console.log("");
