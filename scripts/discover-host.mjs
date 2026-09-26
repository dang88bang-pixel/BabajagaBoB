#!/usr/bin/env node
/**
 * ============================================================================
 * Discovery-Agent: meldet den lokalen Host an die Plattform
 * ============================================================================
 *
 * Aufruf:
 *
 *   BASE=http://127.0.0.1:3000 BOB_DEVICE_ENROLLMENT_SECRET=<geheimnis> \
 *     node scripts/discover-host.mjs
 *
 * Der Agent
 *  1. ermittelt die Fähigkeiten des Hosts (Node, Python, Container-Binaries),
 *  2. meldet die Geräteidentität (`action: "enroll"`),
 *  3. sendet ein Lebenszeichen (`action: "heartbeat"`).
 *
 * Sicherheitsgrenzen:
 *  - Das Geheimnis erlaubt **nur** Discovery und Heartbeat. Autorisieren,
 *    Reservieren und Freigeben bleiben Creator-Akte; das Skript kann das nicht.
 *  - Discovery heißt **nicht** Autorisierung: das Gerät erscheint unautorisiert.
 *  - Es wird kein Geheimnis ausgegeben oder protokolliert; nur Kennung und
 *    Fähigkeiten gehen an die Plattform.
 *  - Kein Shell-Aufruf: die Fähigkeitsprüfung nutzt ausschließlich `existsSync`
 *    auf bekannten Pfaden und Node-Bordmittel (kein `exec`, kein `spawn`).
 */
import {existsSync} from "node:fs";
import {arch, cpus, hostname, platform, totalmem} from "node:os";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const SECRET = process.env.BOB_DEVICE_ENROLLMENT_SECRET ?? "";
const DEVICE_ID = process.env.BOB_DEVICE_ID ?? `DEV-${hostname().toUpperCase().replace(/[^A-Z0-9]/g, "-").slice(0, 24)}`;

if (SECRET.length < 16) {
  console.error("discover-host: BOB_DEVICE_ENROLLMENT_SECRET fehlt oder ist zu kurz (<16 Zeichen) — fail closed, es wird nichts gesendet.");
  process.exit(2);
}

/** Fähigkeiten über bekannte Pfade — kein `which`, kein Shell-Aufruf. */
function capabilities() {
  const found = [];
  if (typeof process.versions.node === "string") found.push("node");
  if (process.execPath) found.push("node-runtime");
  for (const [name, paths] of Object.entries({
    python: ["/usr/bin/python3", "/usr/local/bin/python3"],
    container: ["/usr/bin/docker", "/usr/bin/podman", "/usr/bin/runc"],
    busybox: ["/bin/busybox", "/usr/bin/busybox"]
  })) {
    if (paths.some(candidate => existsSync(candidate))) found.push(name);
  }
  return found;
}

const identity = {
  id: DEVICE_ID,
  name: hostname(),
  os: platform(),
  arch: arch(),
  cpu: cpus().length,
  ramMb: Math.round(totalmem() / 1024 / 1024),
  gpu: "none",
  network: "NONE",
  trust: "EPHEMERAL",
  capabilities: capabilities()
};

async function call(action) {
  const response = await fetch(`${BASE}/api/devices`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({action, secret: SECRET, device: identity})
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* kein JSON */
  }
  return {status: response.status, body, text};
}

const enrolled = await call("enroll");
if (enrolled.status !== 201) {
  console.error(`discover-host: Meldung verweigert (HTTP ${enrolled.status}) ${enrolled.text.slice(0, 200)}`);
  process.exit(1);
}
const heartbeat = await call("heartbeat");
if (heartbeat.status !== 200) {
  console.error(`discover-host: Lebenszeichen verweigert (HTTP ${heartbeat.status}) ${heartbeat.text.slice(0, 200)}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      device: identity.id,
      capabilities: identity.capabilities,
      discovered: true,
      authorized: Boolean(heartbeat.body?.authorized),
      hint: "Discovery ≠ Autorisierung: die Freigabe ist ein Creator-Akt (POST /api/devices {action:\"authorize\"})."
    },
    null,
    2
  )
);
