import crypto from "node:crypto";
import {observe} from "./observability";
import {recordAudit} from "./audit";

/**
 * ============================================================================
 * Geräte-Registrierung (Enrollment) — Discovery ≠ Autorisierung
 * ============================================================================
 *
 * Geräte waren bisher nur über eine Creator-Session registrierbar; ein echter
 * Discovery-Agent konnte sich nicht melden. Dieses Modul ergänzt ein
 * **minimal berechtigtes** Enrollment:
 *
 *  - Das Geheimnis liegt serverseitig in `BOB_DEVICE_ENROLLMENT_SECRET`
 *    (wie `BOB_CREATOR_TOTP_SECRET`), wird **niemals** über die API ausgeliefert
 *    und nie in eine Antwort oder ein Ereignis geschrieben.
 *  - Es erlaubt **ausschließlich** Discovery und Heartbeat. Autorisieren,
 *    Reservieren und Freigeben bleiben Creator-Akte; ein Gerät kann sich also
 *    nicht selbst in die Flotte aufnehmen (kein Selbst-Grant).
 *  - Vergleich in konstanter Zeit; fehlt das Geheimnis, ist Enrollment
 *    **fail closed** deaktiviert (kein stiller Fallback auf „erlaubt").
 *  - Jede Meldung erzeugt ein Ereignis und einen Audit-Eintrag.
 *
 * Der Discovery-Dienst ist `scripts/discover-host.mjs` — er ermittelt die
 * Fähigkeiten des lokalen Hosts (Node, Python, Container) und meldet sie an.
 */

export type EnrollmentIdentity = {
  id: string;
  name: string;
  os: string;
  arch: string;
  cpu?: number;
  ramMb?: number;
  gpu?: string;
  network?: "INTERNET" | "LAN" | "VPN" | "NONE" | "ALLOWLIST";
  trust?: "LOCAL_TRUSTED" | "MANAGED" | "EPHEMERAL" | "EXPERIMENTAL" | "RESTRICTED" | "OBSERVATION_ONLY";
  capabilities?: string[];
};

const MAX_FIELD = 200;

const configuredSecret = (): string => (process.env.BOB_DEVICE_ENROLLMENT_SECRET ?? "").trim();

/** Ist Enrollment konfiguriert? Ohne Geheimnis wird nichts angenommen. */
export function enrollmentAvailable(): boolean {
  return configuredSecret().length >= 16;
}

/** Konstanter Vergleich — kein früher Abbruch, keine Längenleckage über die Zeit. */
function matches(candidate: string): boolean {
  const expected = configuredSecret();
  if (expected.length < 16 || candidate.length === 0) return false;
  const a = Buffer.from(crypto.createHash("sha256").update(candidate).digest());
  const b = Buffer.from(crypto.createHash("sha256").update(expected).digest());
  return crypto.timingSafeEqual(a, b);
}

export type EnrollmentRefusal = {ok: false; code: string; message: string; status: number};

/**
 * Prüft eine Gerätemeldung. Liefert `ok: true` nur bei gültigem Geheimnis und
 * plausibler Identität — sonst einen Verweigerungsgrund für die Route.
 */
export function authorizeEnrollment(secret: unknown, identity: EnrollmentIdentity): EnrollmentRefusal | {ok: true; identity: EnrollmentIdentity} {
  if (!enrollmentAvailable()) {
    return {
      ok: false,
      code: "ENROLLMENT_DISABLED",
      message: "Geräte-Enrollment ist nicht konfiguriert (BOB_DEVICE_ENROLLMENT_SECRET fehlt); Discovery bleibt fail closed.",
      status: 503
    };
  }
  if (typeof secret !== "string" || !matches(secret)) {
    return {ok: false, code: "ENROLLMENT_DENIED", message: "Enrollment-Geheimnis ungültig", status: 403};
  }
  const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  if (!text(identity?.id) || !text(identity?.name) || !text(identity?.os) || !text(identity?.arch)) {
    return {ok: false, code: "ENROLLMENT_IDENTITY", message: "Geräteidentität unvollständig (id, name, os, arch erforderlich)", status: 400};
  }
  // Kennungen landen in Provenienz, Audit und Artefakten. Nur ein enges,
  // sicheres Zeichenalphabet wird angenommen (kein ":", keine Steuerzeichen,
  // keine Leerzeichen) — alles andere ist fail closed abgelehnt.
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(text(identity.id))) {
    return {
      ok: false,
      code: "ENROLLMENT_ID",
      message: "Gerätekennung unzulässig (erlaubt: A-Z a-z 0-9 . _ - , 3–64 Zeichen)",
      status: 400
    };
  }
  for (const [field, value] of Object.entries(identity)) {
    if (typeof value === "string" && value.length > MAX_FIELD) {
      return {ok: false, code: "ENROLLMENT_FIELD", message: `${field} überschreitet ${MAX_FIELD} Zeichen`, status: 400};
    }
  }
  if (Array.isArray(identity.capabilities) && identity.capabilities.length > 32) {
    return {ok: false, code: "ENROLLMENT_CAPABILITIES", message: "zu viele Fähigkeiten gemeldet (max. 32)", status: 400};
  }
  return {ok: true, identity};
}

/** Protokolliert eine angenommene Meldung (Ereignis + Audit, ohne Geheimnis). */
export function recordEnrollment(identity: EnrollmentIdentity, action: "device.enroll" | "device.heartbeat", actor = "AGENT-ENROLLMENT"): void {
  const deviceId = String(identity.id);
  observe({
    type: action === "device.enroll" ? "device.enrolled" : "device.heartbeat",
    message: action === "device.enroll"
      ? `Gerät ${deviceId} gemeldet (Discovery — nicht autorisiert)`
      : `Gerät ${deviceId} meldet sich`,
    status: action === "device.enroll" ? "WAITING" : "COMPLETED",
    actor,
    agentId: actor,
    action,
    resource: deviceId,
    argumentsValue: {os: identity.os, arch: identity.arch, capabilities: identity.capabilities ?? []}
  });
  recordAudit(
    {actor, action, resource: deviceId, decision: "ALLOW"},
    {os: identity.os, arch: identity.arch, capabilities: identity.capabilities ?? []}
  );
}

/**
 * Verweigerung wird ebenfalls festgehalten — mit Grund, ohne Geheimnis.
 *
 * Wichtig: Die Protokollierung darf die Verweigerung **nicht** in einen Fehler
 * verwandeln. Kennungen aus fremden Meldungen sind ungeprüfte Eingaben; sie
 * werden auf ein für Provenienz zulässiges Maß gekürzt und die Aufzeichnung ist
 * fehlertolerant (die Route antwortet weiterhin mit dem beabsichtigten Status).
 */
export function recordEnrollmentDenial(reason: string, reportedId: unknown): void {
  const raw = typeof reportedId === "string" ? reportedId.trim() : "";
  // Provenienz verlangt eine echte, nicht-leere Kennung ≤160 Zeichen ohne ":".
  const resource = raw.slice(0, 120).replace(/[^A-Za-z0-9._-]/g, "-") || "UNKNOWN-REPORT";
  try {
    observe({
      type: "device.enrollment.denied",
      message: `Gerätemeldung verweigert: ${reason}`,
      status: "BLOCKED",
      actor: "AGENT-ENROLLMENT",
      action: "device.enroll",
      resource,
      decision: "DENY"
    });
  } catch {
    /* Beobachtung ist nachrangig — die Verweigerung gilt unabhängig davon. */
  }
  try {
    recordAudit({actor: "AGENT-ENROLLMENT", action: "device.enroll", resource, decision: "DENY"}, {reason});
  } catch {
    /* s. o. */
  }
}
