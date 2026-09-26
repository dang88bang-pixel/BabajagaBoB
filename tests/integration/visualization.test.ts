import {JSDOM} from "jsdom";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {isolatedStorageRoot, TEST_BOOTSTRAP_SECRET} from "../helpers/runtime";

/**
 * Visualisierungs-Fabric (Simulation → Renderer).
 *
 * Geprüft werden nicht nur Strings, sondern **echte** SVGs: jedes Ergebnis wird
 * als XML geparst (jsdom mit `image/svg+xml`). Damit ist belegt, dass die
 * Ausgabe wohlgeformt ist und die zugesagte Struktur trägt — nicht bloß, dass
 * eine Funktion ohne Fehler zurückkehrt.
 *
 * Sicherheitsgrenzen, die hier nachgewiesen werden:
 *  - keine aktiven Inhalte (`<script>`, `javascript:`, Ereignis-Attribute,
 *    externe Referenzen) trotz manipulierter Szenarionamen,
 *  - größenbegrenzte Ausgabe (vollständiges Evidenz-Artefakt, kein Schnitt),
 *  - Route liefert `image/svg+xml` mit passiver CSP, ohne Session 401/428.
 */

const root = isolatedStorageRoot("viz");
void root;

const BASE = "http://localhost:3000";
let viz: typeof import("../../lib/visualization");
let simulation: typeof import("../../lib/simulation");
let artifacts: typeof import("../../lib/artifacts");
let renderRoute: typeof import("../../app/api/simulation/render/route");
let simulationRoute: typeof import("../../app/api/simulation/route");
let cookie = "";

/** Parst als XML und liefert das Dokument — wirft bei fehlerhaftem Markup. */
function parseSvg(svg: string) {
  const dom = new JSDOM(svg, {contentType: "image/svg+xml"});
  return dom.window.document;
}

beforeAll(async () => {
  vi.resetModules();
  viz = await import("../../lib/visualization");
  simulation = await import("../../lib/simulation");
  artifacts = await import("../../lib/artifacts");
  renderRoute = await import("../../app/api/simulation/render/route");
  simulationRoute = await import("../../app/api/simulation/route");
  const auth = await import("../../app/api/auth/route");
  const login = await auth.POST(
    new Request(`${BASE}/api/auth`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({action: "bootstrap", secret: TEST_BOOTSTRAP_SECRET, creatorName: "Viz-Tester"})
    })
  );
  expect(login.status).toBe(201);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
});

describe("Visualisierungs-Fabric", () => {
  it("rendert jede Art als wohlgeformtes SVG", () => {
    const scenario = simulation.createScenario({
      name: "Architektur-Nachweis",
      kind: "ARCHITECTURE",
      inputs: {},
      assumptions: ["Annahme 1"],
      expectedStates: ["COMPLETED"]
    });
    for (const kind of viz.RENDER_KINDS) {
      const result = viz.renderScenarioSvg(scenario.id, kind);
      const document = parseSvg(result.svg);
      expect(document.documentElement.tagName.toLowerCase()).toBe("svg");
      expect(document.querySelector("title")?.textContent?.length ?? 0).toBeGreaterThan(0);
      expect(document.querySelectorAll("rect").length).toBeGreaterThan(0);
      expect(result.kind).toBe(kind);
      expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(result.bytes).toBeGreaterThan(200);
    }
  });

  it("bindet die echten Plattformzustände ein", () => {
    const control = simulation.listScenarios();
    expect(control.length).toBeGreaterThan(0);
    const rendered = viz.renderScenarioSvg(control[0].id, "ARCHITECTURE");
    const document = parseSvg(rendered.svg);
    // Die Durchsetzungskette muss ihre Stufen benennen — nicht Platzhalter.
    const text = document.documentElement.textContent ?? "";
    for (const stage of ["Intent", "Policy", "Authorization", "Execution Gate", "Broker", "Isolated Runtime", "Evidence"]) {
      expect(text).toContain(stage);
    }
    // Kein Platzhaltertext, keine leeren Zahlen.
    expect(text).not.toMatch(/lorem|TODO|XXX/i);
    expect(text).toMatch(/\d+ Missionen/);
  });

  it("ist deterministisch bei gleichem Zustand", () => {
    const scenario = simulation.listScenarios()[0];
    const first = viz.renderScenarioSvg(scenario.id, "NETWORK");
    const second = viz.renderScenarioSvg(scenario.id, "NETWORK");
    expect(second.svg).toBe(first.svg);
    expect(second.digest).toBe(first.digest);
  });

  it("escaped Szenarionamen und weist aktive Inhalte zurück", () => {
    const hostile = simulation.createScenario({
      name: `<script>alert("x")</script> onload="boom" & 'zitat'`,
      kind: "SCENE_3D",
      inputs: {},
      assumptions: [],
      expectedStates: []
    });
    const rendered = viz.renderScenarioSvg(hostile.id, "SCENE_3D");
    const document = parseSvg(rendered.svg);
    expect(document.querySelectorAll("script").length).toBe(0);
    expect(rendered.svg).not.toMatch(/javascript:/i);
    // Nur Markup zählt: Textinhalt, der wie ein Attribut aussieht, bleibt Text.
    const tags = (rendered.svg.match(/<[^>]*>/g) ?? []).join(" ");
    expect(tags).not.toMatch(/\son[a-z]+\s*=/i);
    expect(tags).not.toMatch(/(?:href|src)\s*=\s*["']?(?:https?:)?\/\//i);
    // Der Renderer prüft die Ausgabe zusätzlich selbst (Defense in Depth).
    // Textinhalt, der wie ein Attribut aussieht, ist erlaubt (er ist escapt und
    // wird angezeigt); echtes Markup mit Ereignis-Attribut wird verweigert.
    expect(() => viz.assertPassiveSvg('<svg><rect x="1" y="1" onload="boom"/></svg>')).toThrow(/Ereignis-Attribut/);
    expect(viz.assertPassiveSvg("<svg><text>onload= und href=// sind hier Text</text></svg>")).toBeUndefined();
    expect(() => viz.assertPassiveSvg("<svg><script>alert(1)</script></svg>")).toThrow(/Skriptelement/);
    expect(() => viz.assertPassiveSvg('<svg><a href="javascript:alert(1)"/></svg>')).toThrow(/Skript-URL/);
    expect(() => viz.assertPassiveSvg('<svg><image href="https://example.invalid/x.png"/></svg>')).toThrow(/Externe Referenz/);
  });

  it("hält die Ausgabe als vollständiges Evidenz-Artefakt (Größenlimit)", () => {
    // Viele Objekte: der Renderer muss kürzen (weniger Knoten), nicht abschneiden.
    for (let index = 0; index < 40; index += 1) {
      simulation.createScenario({
        name: `Last-${index} ${"x".repeat(80)}`,
        kind: "FLOW",
        inputs: {},
        assumptions: [`Annahme ${"y".repeat(120)}`],
        expectedStates: []
      });
    }
    const scenario = simulation.listScenarios()[0];
    for (const kind of viz.RENDER_KINDS) {
      const rendered = viz.renderScenarioSvg(scenario.id, kind);
      expect(rendered.bytes).toBeLessThan(artifacts.MAX_CONTENT_BYTES);
      parseSvg(rendered.svg); // vollständig, nicht abgeschnitten
    }
  });

  it("legt die Visualisierung als digest-geprüftes Artefakt ab", () => {
    const scenario = simulation.listScenarios()[0];
    const before = artifacts.artifactSnapshot({kind: "VISUALIZATION"}).length;
    const recorded = viz.renderScenarioArtifact(scenario.id, "TIMELINE");
    expect(recorded.truncated).toBe(false);
    expect(rendered(recorded.artifactId)).toBe(recorded.digest);
    const stored = artifacts.artifactSnapshot({kind: "VISUALIZATION"});
    expect(stored.length).toBe(before + 1);
    expect(stored[0].contentType).toBe("image/svg+xml");
    const verification = artifacts.verifyArtifact(recorded.artifactId);
    expect(verification.ok).toBe(true);

    function rendered(id: string) {
      const artifact = artifacts.getArtifact(id);
      expect(artifact?.content).toContain("<svg");
      return artifact?.digest;
    }
  });

  it("verweigert unbekannte Arten und unbekannte Szenarien", () => {
    const scenario = simulation.listScenarios()[0];
    expect(() => viz.renderScenarioSvg(scenario.id, "HOLOGRAMM" as never)).toThrow(/unsupported visualization kind/);
    expect(() => viz.renderScenarioSvg("SCN-GIBTSNICHT", "FLOW")).toThrow(/scenario not found/);
  });
});

describe("Visualisierungs-Route", () => {
  it("liefert das SVG als passives Bild", async () => {
    const scenario = simulation.listScenarios()[0];
    const response = await renderRoute.GET(new Request(`${BASE}/api/simulation/render?id=${scenario.id}&kind=ARCHITECTURE`, {headers: {cookie}}));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const svg = await response.text();
    expect(parseSvg(svg).documentElement.tagName.toLowerCase()).toBe("svg");
  });

  it("verweigert Zugriff ohne Session", async () => {
    const scenario = simulation.listScenarios()[0];
    const response = await renderRoute.GET(new Request(`${BASE}/api/simulation/render?id=${scenario.id}`));
    expect([401, 428]).toContain(response.status);
  });

  it("meldet unbekannte Arten mit 400 und unbekannte Szenarien mit 404", async () => {
    const scenario = simulation.listScenarios()[0];
    const badKind = await renderRoute.GET(new Request(`${BASE}/api/simulation/render?id=${scenario.id}&kind=NOPE`, {headers: {cookie}}));
    expect(badKind.status).toBe(400);
    const missing = await renderRoute.GET(new Request(`${BASE}/api/simulation/render?id=SCN-GIBTSNICHT`, {headers: {cookie}}));
    expect(missing.status).toBe(404);
  });

  it("rendert über die geschützte POST-Aktion (Creator) und auditiert", async () => {
    const scenario = simulation.listScenarios()[0];
    const response = await simulationRoute.POST(
      new Request(`${BASE}/api/simulation`, {
        method: "POST",
        headers: {"content-type": "application/json", cookie},
        body: JSON.stringify({action: "render", id: scenario.id, kind: "STATE_MACHINE"})
      })
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {render: {artifactId: string; digest: string; bytes: number}};
    expect(body.render.artifactId.startsWith("ART-")).toBe(true);
    expect(body.render.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(body.render.bytes).toBeGreaterThan(0);

    const unknown = await simulationRoute.POST(
      new Request(`${BASE}/api/simulation`, {
        method: "POST",
        headers: {"content-type": "application/json", cookie},
        body: JSON.stringify({action: "render", id: scenario.id, kind: "NOPE"})
      })
    );
    expect(unknown.status).toBe(400);

    // Ein unbekanntes Szenario ist „nicht gefunden" — auf beiden Wegen gleich.
    const missingScenario = await simulationRoute.POST(
      new Request(`${BASE}/api/simulation`, {
        method: "POST",
        headers: {"content-type": "application/json", cookie},
        body: JSON.stringify({action: "render", id: "SCN-GIBTSNICHT", kind: "FLOW"})
      })
    );
    expect(missingScenario.status).toBe(404);

    const anonymous = await simulationRoute.POST(
      new Request(`${BASE}/api/simulation`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({action: "render", id: scenario.id, kind: "FLOW"})
      })
    );
    expect([401, 428]).toContain(anonymous.status);
  });
});
