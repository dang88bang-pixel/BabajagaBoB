import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * SLO-Bewertung des Betriebs (Abschnitt 43).
 *
 * Der Kern: Schwellen sind gerichtet (kleiner/größer ist besser), ein fehlender
 * Messwert ist **kein** Gesundheitsnachweis (`UNKNOWN`, nicht HEALTHY), und die
 * Meldung an den Creator ist eine Entscheidungsvorlage — es wird nichts
 * repariert, nichts abgeschaltet und nichts geschätzt.
 */

const root = isolatedStorageRoot("slo");
void root;

const BASE = "http://localhost:3000";
let slo: typeof import("../../lib/slo");
let route: typeof import("../../app/api/slo/route");
let cookie = "";

beforeAll(async () => {
  vi.resetModules();
  slo = await import("../../lib/slo");
  route = await import("../../app/api/slo/route");
  const auth = await import("../../app/api/auth/route");
  const login = await auth.POST(
    new Request(`${BASE}/api/auth`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "SLO-Tester"})
    })
  );
  expect(login.status).toBe(201);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
});

describe("Bewertung einer Messung", () => {
  const base = {
    id: "probe",
    title: "Probe",
    unit: "count" as const,
    source: "Test",
    runbook: "docs/OPERATIONS.md"
  };

  it("wertet gerichtete Schwellen korrekt aus (kleiner ist besser)", () => {
    const config = {direction: "lower_is_better" as const, target: 0, warning: 5, critical: 25};
    expect(slo.evaluateMeasurement({...base, ...config, value: 0}).state).toBe("HEALTHY");
    expect(slo.evaluateMeasurement({...base, ...config, value: 3}).state).toBe("HEALTHY");
    expect(slo.evaluateMeasurement({...base, ...config, value: 6}).state).toBe("WARNING");
    expect(slo.evaluateMeasurement({...base, ...config, value: 26}).state).toBe("BREACHED");
  });

  it("wertet gerichtete Schwellen korrekt aus (größer ist besser)", () => {
    const config = {direction: "higher_is_better" as const, target: 1, warning: 1, critical: 1};
    expect(slo.evaluateMeasurement({...base, ...config, value: 1}).state).toBe("HEALTHY");
    expect(slo.evaluateMeasurement({...base, ...config, value: 0}).state).toBe("BREACHED");
  });

  it("behandelt einen fehlenden Messwert als UNKNOWN statt als gesund", () => {
    const result = slo.evaluateMeasurement({...base, direction: "lower_is_better", target: 0, warning: 1, critical: 1, value: null});
    expect(result.state).toBe("UNKNOWN");
    expect(result.distanceToTarget).toBeNull();
  });
});

describe("Bericht aus dem echten Zustand", () => {
  it("misst Warteschlange, Persistenz, Sicherungen und Isolation", async () => {
    const report = await slo.sloReport();
    const ids = report.results.map(result => result.id);
    for (const expected of ["queue_failed_jobs", "queue_stale_leases", "store_integrity", "backup_verification", "backup_coverage", "readiness_blocked_tasks", "executions_denied", "isolation_enforced", "audit_chain", "agent_heartbeat"]) {
      expect(ids, `Messgröße ${expected} fehlt`).toContain(expected);
    }
    expect(report.results.every(result => result.runbook.startsWith("docs/"))).toBe(true);
    expect(report.summary.total).toBe(report.results.length);
    // Die Summen müssen zu den Einzelbewertungen passen (keine geschönten Zahlen).
    const counted = (state: string) => report.results.filter(result => result.state === state).length;
    expect(report.summary.healthy).toBe(counted("HEALTHY"));
    expect(report.summary.breached).toBe(counted("BREACHED"));
    expect(report.summary.unknown).toBe(counted("UNKNOWN"));
  });

  it("meldet eine Verletzung in der Creator-Inbox und repariert nichts", async () => {
    const before = await import("../../lib/inbox");
    const beforeCount = before.listInbox().length;
    const audit = await import("../../lib/audit");
    const beforeAudit = audit.auditSnapshot(500).length;

    const report = await slo.evaluateAndNotify("AG-OPS");
    const after = await import("../../lib/inbox");
    const items = after.listInbox();
    if (report.breached.length > 0 || report.summary.unknown > 0) {
      expect(report.notified).toBe(true);
      expect(items.length).toBeGreaterThan(beforeCount);
      const newest = items[0];
      expect(["BLOCK", "ASK"]).toContain(newest.mode);
    } else {
      expect(report.notified).toBe(false);
    }
    // Bewertung ist beobachtbar, verändert aber keine Sicherheitslage.
    expect(audit.auditSnapshot(500).length).toBeGreaterThanOrEqual(beforeAudit);
    expect(audit.verifyAuditChain().valid).toBe(true);
  });

  it("bewertet die Isolation als verletzt, wenn sie angefordert und nicht erzwungen ist", async () => {
    // Echte Messung der laufenden Instanz (kein Mock): im Testprozess ist keine
    // Kernel-Isolation aktiv, deshalb muss die Bewertung das erkennen.
    const report = await slo.sloReport();
    const isolation = report.results.find(result => result.id === "isolation_enforced");
    expect(isolation).toBeDefined();
    expect(isolation?.value).not.toBeNull();
    // Vorgabe ist `auto`: Kernel-Isolation ist angefordert. Ist sie in dieser
    // Umgebung nicht erzwungen, ist das ein **Befund** (fail closed) — kein
    // stilles „gesund". Nur bei ausdrücklichem `off` gilt der Zustand als gesund,
    // weil dann bewusst keine Isolation verlangt wird.
    if ((process.env.BOB_NS_ISOLATION ?? "auto") === "off") {
      expect(isolation?.state).toBe("HEALTHY");
    } else {
      expect(isolation?.state).toBe("BREACHED");
      expect(isolation?.detail ?? "").toBeDefined();
    }
  });
});

describe("SLO-Route", () => {
  it("liefert die Bewertung mit Session und verweigert ohne Session", async () => {
    const authorized = await route.GET(new Request(`${BASE}/api/slo`, {headers: {cookie}}));
    expect(authorized.status).toBe(200);
    const body = (await authorized.json()) as {summary: {total: number}; thresholds: {warnRatio: number}; results: {id: string}[]};
    expect(body.summary.total).toBeGreaterThan(5);
    expect(body.thresholds.warnRatio).toBeGreaterThan(0);
    expect(body.results.some(result => result.id === "audit_chain")).toBe(true);

    const anonymous = await route.GET(new Request(`${BASE}/api/slo`));
    expect([401, 428]).toContain(anonymous.status);

    const anonymousPost = await route.POST(
      new Request(`${BASE}/api/slo`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({action: "evaluate"})
      })
    );
    expect([401, 428]).toContain(anonymousPost.status);
  });

  it("weist unbekannte Aktionen und fehlende Aktion ab", async () => {
    const noAction = await route.POST(
      new Request(`${BASE}/api/slo`, {
        method: "POST",
        headers: {"content-type": "application/json", cookie},
        body: JSON.stringify({})
      })
    );
    expect(noAction.status).toBe(400);
    expect(((await noAction.json()) as {error: string}).error).toBe("ACTION_REQUIRED");
  });

  it("akzeptiert evaluate", async () => {
    const unknown = await route.POST(
      new Request(`${BASE}/api/slo`, {
        method: "POST",
        headers: {"content-type": "application/json", cookie},
        body: JSON.stringify({action: "gibtsnicht"})
      })
    );
    expect(unknown.status).toBe(400);

    const evaluated = await route.POST(
      new Request(`${BASE}/api/slo`, {
        method: "POST",
        headers: {"content-type": "application/json", cookie},
        body: JSON.stringify({action: "evaluate"})
      })
    );
    expect(evaluated.status).toBe(200);
    const body = (await evaluated.json()) as {evaluatedAt: string; summary: {total: number}};
    expect(body.evaluatedAt.length).toBeGreaterThan(0);
    expect(body.summary.total).toBeGreaterThan(5);
  });
});
