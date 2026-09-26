import {afterEach, beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Durchsetzung der Betriebsgrenzen an der API-Grenze (OPS-004).
 *
 * `tests/unit/ops-hardening.test.ts` prüft die Bausteine (Fensterlogik, Drain-
 * Zustand, HMAC-Ableitung). Hier wird geprüft, dass sie an der Grenze auch
 * **wirken**: 429 mit `Retry-After` statt Durchlassen, 503 während der
 * Drainage statt neuer Arbeit, und ein Produktionsstart ohne externalisiertes
 * Session-Geheimnis schlägt fehl, statt still auf einen Entwicklerwert
 * zurückzufallen.
 *
 * Diese Datei trägt die Sabotageproben `RATE_LIMIT_NOT_ENFORCED`,
 * `SHUTDOWN_DRAIN_IGNORED` und `SESSION_SECRET_REQUIRED_IN_PRODUCTION`.
 */

isolatedStorageRoot("sec-ops-enforcement");

let apiGate: typeof import("../../lib/api/api-gate");
let rateLimit: typeof import("../../lib/api/rate-limit");
let shutdown: typeof import("../../lib/shutdown");
let sessionSecret: typeof import("../../lib/session-secret");
let audit: typeof import("../../lib/audit");
let bootstrap: typeof import("../../lib/bootstrap");

beforeAll(async () => {
  vi.resetModules();
  bootstrap = await import("../../lib/bootstrap");
  apiGate = await import("../../lib/api/api-gate");
  rateLimit = await import("../../lib/api/rate-limit");
  shutdown = await import("../../lib/shutdown");
  sessionSecret = await import("../../lib/session-secret");
  audit = await import("../../lib/audit");
  bootstrap.completeBootstrap({secret: TEST_BOOTSTRAP_SECRET, creatorName: "Ops-Grenze"});
});

afterEach(() => {
  rateLimit.rateLimitResetForTests();
  delete process.env.BOB_RATE_LIMIT_MAX;
  delete process.env.BOB_RATE_LIMIT_WINDOW_MS;
  delete process.env.BOB_SHUTTING_DOWN;
});

describe("Betriebsgrenzen an der API-Grenze", () => {
  it("verweigert oberhalb des Budgets mit 429 und Retry-After", async () => {
    process.env.BOB_RATE_LIMIT_MAX = "2";
    process.env.BOB_RATE_LIMIT_WINDOW_MS = "60000";
    const request = () =>
      new Request("http://localhost:3000/api/runs", {method: "GET", headers: {"user-agent": "grenze-test"}});

    const first = apiGate.guardOrDeny(request(), {action: "run:read", requireSession: true});
    const second = apiGate.guardOrDeny(request(), {action: "run:read", requireSession: true});
    const third = apiGate.guardOrDeny(request(), {action: "run:read", requireSession: true});

    // Die ersten beiden werden mangels Session abgelehnt (401) — sie zählen aber
    // gegen das Budget. Der dritte scheitert an der Betriebsgrenze.
    expect(first?.status).toBe(401);
    expect(second?.status).toBe(401);
    expect(third?.status).toBe(429);
    expect(third?.headers.get("retry-after")).toMatch(/^\d+$/);
    const body = (await third?.json()) as {error: string};
    expect(body.error).toBe("RATE_LIMITED");
    // Eine Verweigerung ohne Spur wäre im Nachweis unbrauchbar.
    expect(
      audit.auditSnapshot(300).some(record => record.action === "rate-limit" && record.decision === "DENY")
    ).toBe(true);
  });

  it("hinterlässt begrenzte Anmeldeversuche im Audit (Spur statt stummer Abwehr)", async () => {
    process.env.BOB_AUTH_RATE_LIMIT_MAX = "1";
    process.env.BOB_RATE_LIMIT_WINDOW_MS = "60000";
    const authRoute = await import("../../app/api/auth/route");
    const request = () =>
      new Request("http://localhost:3000/api/auth", {
        method: "POST",
        headers: {"content-type": "application/json", "user-agent": "anmelde-flut-test"},
        body: JSON.stringify({action: "login", secret: "falsch"})
      });
    // `auditSnapshot` liefert die jüngsten Datensätze (neueste zuerst, begrenzt);
    // neue Einträge werden deshalb über die Sequenz erkannt, nicht über die Länge.
    const beforeSequence = audit.auditSnapshot(1)[0]?.sequence ?? 0;

    const first = await authRoute.POST(request());
    const second = await authRoute.POST(request());

    expect(first.status).not.toBe(429);
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(((await second.json()) as {error: string}).error).toBe("RATE_LIMITED");

    const added = audit.auditSnapshot(50).filter(record => record.sequence > beforeSequence);
    // Genau die Lücke, die früher bestand: der begrenzte Anmeldeversuch war
    // nicht im Audit — eine blockierte Aktion ohne Nachweis.
    const denial = added.find(record => record.action === "rate-limit" && record.decision === "DENY");
    expect(denial).toBeDefined();
    // Die Clientkennung darf nie im Klartext im Audit stehen.
    expect(JSON.stringify(denial)).not.toContain("anmelde-flut-test");
    delete process.env.BOB_AUTH_RATE_LIMIT_MAX;
  });

  it("nimmt während der Drainage keine neue Control-Plane-Arbeit an (503)", async () => {
    const request = () => new Request("http://localhost:3000/api/runs", {method: "GET", headers: {"user-agent": "drain-test"}});
    // Ohne Drainage greift die normale Autorisierung (401 ohne Session).
    expect(apiGate.guardOrDeny(request(), {action: "run:read"})?.status).toBe(401);

    // Drainage über die Umgebungsvariable (der Signalpfad setzt denselben
    // Zustand über `beginShutdown`; hier wird der beobachtbare Effekt geprüft).
    process.env.BOB_SHUTTING_DOWN = "1";
    const denied = apiGate.guardOrDeny(request(), {action: "run:read"});
    expect(denied?.status).toBe(503);
    expect(denied?.headers.get("retry-after")).toMatch(/^\d+$/);
    const body = (await denied?.json()) as {error: string};
    expect(body.error).toBe("SHUTTING_DOWN");
  });

  it("meldet den Drainage-Zustand für Readiness und Ausrollvorgänge", () => {
    expect(shutdown.shutdownStatus().draining).toBe(false);
    shutdown.beginShutdown("TEST-GRENZE");
    expect(shutdown.isShuttingDown()).toBe(true);
    expect(shutdown.shutdownStatus().startedAt).toEqual(expect.any(String));
  });
});

describe("Externalisiertes Sitzungsgeheimnis", () => {
  it("verweigert den Produktionsstart ohne BOB_SESSION_SECRET (fail closed)", () => {
    const previous = process.env.NODE_ENV;
    delete process.env.BOB_SESSION_SECRET;
    // `process.env.NODE_ENV` ist in den Next-Typen read-only deklariert; für den
    // Test wird deshalb über das Env-Objekt geschrieben.
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    try {
      expect(() => sessionSecret.sessionSecret()).toThrow(/BOB_SESSION_SECRET/);
      expect(() => sessionSecret.hashSessionSecret("egal")).toThrow();
    } finally {
      if (previous === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
      else (process.env as Record<string, string | undefined>).NODE_ENV = previous;
    }
  });

  it("lehnt ein zu kurzes Geheimnis auch außerhalb der Produktion ab", () => {
    process.env.BOB_SESSION_SECRET = "kurz";
    try {
      // Zu kurze Werte zählen nicht als externalisiertes Geheimnis: Sie fallen
      // in den Entwicklungspfad — in Produktion wäre das der Fehler oben.
      expect(sessionSecret.sessionSecret()).not.toBe("kurz");
    } finally {
      delete process.env.BOB_SESSION_SECRET;
    }
  });

  it("bindet die Sitzungssignatur an das externalisierte Geheimnis", () => {
    process.env.BOB_SESSION_SECRET = "0123456789abcdef0123456789abcdef";
    const first = sessionSecret.hashSessionSecret("SES-BEISPIEL");
    process.env.BOB_SESSION_SECRET = "fedcba9876543210fedcba9876543210";
    const second = sessionSecret.hashSessionSecret("SES-BEISPIEL");
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    delete process.env.BOB_SESSION_SECRET;
  });
});
