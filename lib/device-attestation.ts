import crypto from "node:crypto";
import {createStore} from "./persistence/store";
import {observe} from "./observability";
import {recordAudit} from "./audit";
import {listDevices} from "./devices";

/**
 * ============================================================================
 * Geräte-Attestierung — Nachweis der Identität, ohne Autorisierung
 * ============================================================================
 *
 * Discovery meldet, wer da ist. Attestierung beantwortet die nächste Frage:
 * **Ist das wirklich dieses Gerät?** Dazu erhält das Gerät eine einmalige
 * Herausforderung und muss sie mit dem Enrollment-Geheimnis quittieren.
 *
 * Grenzen, die hier ausdrücklich gelten:
 *
 *  - **Attestierung ≠ Autorisierung.** Ein attestiertes Gerät wechselt in
 *    `IDENTIFIED`, nicht in `AUTHORIZED`. Nutzen darf es nur der Creator.
 *  - **Kein Selbst-Grant.** Die Herausforderung wird serverseitig ausgestellt;
 *    das Gerät kann sie sich nicht selbst geben oder verlängern.
 *  - **Replay-Sperre.** Jede Nonce wird genau einmal verbraucht — auch dann,
 *    wenn die Quittung falsch war (sonst wäre Raten möglich).
 *  - **Zeitgrenze.** Abgelaufene Herausforderungen sind wertlos.
 *  - **Konstanter Vergleich.** Kein früher Abbruch über die Zeit.
 *  - **Begrenzte Versuche.** Zu viele Fehlversuche je Gerät sperren die
 *    Attestierung für dieses Gerät (`LOCKED`), damit kein Raten möglich ist.
 *
 * Das Geheimnis selbst verlässt nie den Server: Es wird nicht ausgegeben, nicht
 * protokolliert und nicht in Evidenz geschrieben.
 */

export type AttestationChallenge = {
  challengeId: string;
  deviceId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  consumed: boolean;
};

export type AttestationRecord = {
  attestationId: string;
  deviceId: string;
  challengeId: string;
  verified: boolean;
  reason: string;
  method: "HMAC_SHA256";
  observedAt: string;
};

type Payload = {challenges: AttestationChallenge[]; attestations: AttestationRecord[]};

const store = createStore<Payload>("device-attestation", 1, () => ({challenges: [], attestations: []}));

/** Gültigkeitsdauer einer Herausforderung (kurz: ein Scan läuft in Sekunden). */
const CHALLENGE_TTL_MS = 120_000;
/** Ab dieser Zahl von Fehlversuchen ist die Attestierung je Gerät gesperrt. */
const MAX_FAILURES = 5;
/** Sperrdauer nach zu vielen Fehlversuchen. */
const LOCKOUT_MS = 900_000;

const configuredSecret = (): string => (process.env.BOB_DEVICE_ENROLLMENT_SECRET ?? "").trim();

export function attestationAvailable(): boolean {
  return configuredSecret().length >= 16;
}

/** Erwartete Quittung: HMAC-SHA256 über `deviceId.nonce` (Geheimnis bleibt lokal). */
export function signAttestation(deviceId: string, nonce: string, secret: string): string {
  if (typeof deviceId !== "string" || deviceId.trim().length === 0) throw new Error("deviceId required");
  if (typeof nonce !== "string" || nonce.trim().length === 0) throw new Error("nonce required");
  if (typeof secret !== "string" || secret.length < 16) throw new Error("secret required");
  return crypto.createHmac("sha256", secret).update(`${deviceId}.${nonce}`).digest("hex");
}

/** Konstanter Vergleich zweier HMAC-Werte (kein Zeitkanal über die Länge). */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(crypto.createHash("sha256").update(a).digest());
  const right = Buffer.from(crypto.createHash("sha256").update(b).digest());
  return crypto.timingSafeEqual(left, right);
}

function recentFailures(deviceId: string): number {
  const cutoff = Date.now() - LOCKOUT_MS;
  return store
    .read()
    .attestations.filter(entry => entry.deviceId === deviceId && !entry.verified && new Date(entry.observedAt).getTime() > cutoff).length;
}

function record(
  deviceId: string,
  challengeId: string,
  verified: boolean,
  reason: string
): AttestationRecord {
  const entry: AttestationRecord = {
    attestationId: `ATT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    deviceId,
    challengeId,
    verified,
    reason,
    method: "HMAC_SHA256",
    observedAt: new Date().toISOString()
  };
  store.update(payload => {
    payload.attestations.push(entry);
    if (payload.attestations.length > 2000) payload.attestations.splice(0, payload.attestations.length - 2000);
  });
  observe({
    type: verified ? "device.attested" : "device.attestation.denied",
    message: verified ? `Gerät ${deviceId} attestiert (Identität nachgewiesen — nicht autorisiert)` : `Attestierung für ${deviceId} verweigert: ${reason}`,
    status: verified ? "COMPLETED" : "BLOCKED",
    actor: "AGENT-ENROLLMENT",
    agentId: "AGENT-ENROLLMENT",
    action: "device.attest",
    resource: deviceId,
    decision: verified ? "ALLOW" : "DENY",
    argumentsValue: {challengeId, reason}
  });
  recordAudit({actor: "AGENT-ENROLLMENT", action: "device.attest", resource: deviceId, decision: verified ? "ALLOW" : "DENY"}, {challengeId, reason});
  return structuredClone(entry);
}

/**
 * Stellt eine einmalige Herausforderung für ein **bekanntes** Gerät aus.
 *
 * Nur registrierte Geräte erhalten eine Herausforderung: Sonst könnte ein
 * Angreifer mit einer erfundenen Kennung eine gültige Quittung erzeugen und
 * damit ein Phantomgerät in der Flotte belegen.
 */
export function issueAttestationChallenge(deviceId: string): AttestationChallenge {
  if (!attestationAvailable()) {
    throw Object.assign(new Error("Attestierung ist nicht konfiguriert (BOB_DEVICE_ENROLLMENT_SECRET fehlt) — fail closed"), {
      status: 503,
      code: "ATTESTATION_DISABLED"
    });
  }
  if (typeof deviceId !== "string" || !/^[A-Za-z0-9._-]{3,64}$/.test(deviceId)) {
    throw Object.assign(new Error("Gerätekennung unzulässig (erlaubt: A-Z a-z 0-9 . _ - , 3–64 Zeichen)"), {status: 400, code: "ATTESTATION_ID"});
  }
  if (!listDevices().some(device => device.id === deviceId)) {
    throw Object.assign(new Error(`Gerät nicht registriert: ${deviceId} — Discovery geht der Attestierung voraus`), {
      status: 404,
      code: "DEVICE_NOT_FOUND"
    });
  }
  if (recentFailures(deviceId) >= MAX_FAILURES) {
    throw Object.assign(new Error(`Zu viele Fehlversuche für ${deviceId} — Attestierung gesperrt (${LOCKOUT_MS / 60_000} Minuten)`), {
      status: 423,
      code: "ATTESTATION_LOCKED"
    });
  }

  const challenge: AttestationChallenge = {
    challengeId: `CHL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    deviceId,
    nonce: crypto.randomBytes(24).toString("base64url"),
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    consumed: false
  };
  store.update(payload => {
    // Ältere offene Herausforderungen desselben Geräts werden verworfen, damit
    // keine unbegrenzt vielen gültigen Nonces gleichzeitig im Umlauf sind.
    for (const entry of payload.challenges) if (entry.deviceId === deviceId) entry.consumed = true;
    payload.challenges.push(challenge);
    if (payload.challenges.length > 1000) payload.challenges.splice(0, payload.challenges.length - 1000);
  });
  observe({
    type: "device.attestation.challenged",
    message: `Herausforderung ${challenge.challengeId} für ${deviceId} ausgestellt (einmalig, ${CHALLENGE_TTL_MS / 1000}s gültig)`,
    status: "WAITING",
    actor: "CREATOR",
    action: "device.attest.challenge",
    resource: deviceId,
    argumentsValue: {challengeId: challenge.challengeId, expiresAt: challenge.expiresAt}
  });
  recordAudit({actor: "CREATOR", action: "device.attest.challenge", resource: deviceId, decision: "ALLOW"}, {challengeId: challenge.challengeId});
  return structuredClone(challenge);
}

export type AttestationVerdict = {ok: false; code: string; message: string; status: number} | {ok: true; deviceId: string; attestationId: string};

/**
 * Prüft eine Quittung. Liefert `ok: true` nur bei gültiger, nicht verbrauchter
 * und nicht abgelaufener Herausforderung. Jede Prüfung — auch die falsche —
 * verbraucht die Nonce und wird aufgezeichnet.
 */
export function verifyAttestation(deviceId: unknown, challengeId: unknown, proof: unknown): AttestationVerdict {
  const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  if (!attestationAvailable()) {
    return {ok: false, code: "ATTESTATION_DISABLED", message: "Attestierung ist nicht konfiguriert — fail closed", status: 503};
  }
  const id = text(deviceId);
  const challenge = text(challengeId);
  const claimedProof = text(proof);
  if (!id || !challenge || !claimedProof) {
    return {ok: false, code: "ATTESTATION_INPUT", message: "deviceId, challengeId und proof sind erforderlich", status: 400};
  }

  const payload = store.read();
  const entry = payload.challenges.find(item => item.challengeId === challenge && item.deviceId === id);
  if (!entry) {
    record(id, challenge, false, "Herausforderung unbekannt");
    return {ok: false, code: "ATTESTATION_CHALLENGE", message: "Herausforderung unbekannt", status: 404};
  }
  if (entry.consumed) {
    record(id, challenge, false, "Herausforderung bereits verbraucht (Replay)");
    return {ok: false, code: "ATTESTATION_REPLAY", message: "Herausforderung wurde bereits verwendet", status: 409};
  }
  if (new Date(entry.expiresAt).getTime() <= Date.now()) {
    store.update(current => {
      const target = current.challenges.find(item => item.challengeId === challenge);
      if (target) target.consumed = true;
    });
    record(id, challenge, false, "Herausforderung abgelaufen");
    return {ok: false, code: "ATTESTATION_EXPIRED", message: "Herausforderung ist abgelaufen", status: 410};
  }
  if (recentFailures(id) >= MAX_FAILURES) {
    return {ok: false, code: "ATTESTATION_LOCKED", message: `Zu viele Fehlversuche für ${id} — Attestierung gesperrt`, status: 423};
  }

  // Die Nonce wird **vor** dem Vergleich verbraucht: ein falscher Versuch darf
  // nicht wiederholbar sein.
  store.update(current => {
    const target = current.challenges.find(item => item.challengeId === challenge);
    if (target) target.consumed = true;
  });

  const expected = signAttestation(entry.deviceId, entry.nonce, configuredSecret());
  if (!constantTimeEquals(claimedProof, expected)) {
    record(id, challenge, false, "Quittung ungültig");
    return {ok: false, code: "ATTESTATION_PROOF", message: "Quittung ungültig", status: 403};
  }

  const recorded = record(id, challenge, true, "Quittung gültig");
  return {ok: true, deviceId: id, attestationId: recorded.attestationId};
}

/** Betriebssicht: offene Herausforderungen, Attestierungen und Sperren. */
export function attestationSummary() {
  const payload = store.read();
  const devices = listDevices();
  const attestedIds = new Set(
    payload.attestations.filter(entry => entry.verified).map(entry => entry.deviceId)
  );
  return {
    available: attestationAvailable(),
    method: "HMAC_SHA256" as const,
    challengeTtlMs: CHALLENGE_TTL_MS,
    maxFailures: MAX_FAILURES,
    lockoutMs: LOCKOUT_MS,
    openChallenges: payload.challenges.filter(entry => !entry.consumed && new Date(entry.expiresAt).getTime() > Date.now()).length,
    totalAttestations: payload.attestations.length,
    verified: payload.attestations.filter(entry => entry.verified).length,
    denied: payload.attestations.filter(entry => !entry.verified).length,
    attestedDevices: [...attestedIds].length,
    lockedDevices: devices.filter(device => recentFailures(device.id) >= MAX_FAILURES).map(device => device.id),
    ...store.integrity()
  };
}

/** Offene Herausforderungen eines Geräts (für den Agenten, ohne Nonce-Geheimnis). */
export function openChallenges(deviceId: string) {
  const now = Date.now();
  return store
    .read()
    .challenges.filter(entry => entry.deviceId === deviceId && !entry.consumed && new Date(entry.expiresAt).getTime() > now)
    .map(entry => ({challengeId: entry.challengeId, deviceId: entry.deviceId, nonce: entry.nonce, expiresAt: entry.expiresAt}));
}
