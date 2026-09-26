import crypto from "node:crypto";
import {recordArtifact, MAX_CONTENT_BYTES} from "./artifacts";
import {snapshot as controlSnapshot} from "./control-plane";
import {listSandboxes} from "./sandbox/fabric";
import {listRuns} from "./runs";
import {listErrorIncidents, ERROR_TRANSITIONS} from "./error-intelligence";
import {listDomainEvents} from "./events/log";
import {capabilityTokenViews, authorityGraph} from "./authority";
import {listRuntimes} from "./runtime-registry";
import {listComputers} from "./computer-use";
import {listDevices} from "./devices";
import {listProviders} from "./provider-fabric";
import {listScenarios} from "./simulation";
import {observe} from "./observability";

/**
 * ============================================================================
 * Visualisierungs-Fabric
 * ============================================================================
 *
 * Szenarien waren bisher nur Datensätze („Simulation/Visualisierung: keine
 * Renderer"). Dieses Modul **rendert** sie deterministisch als SVG — aus den
 * echten Plattformzuständen, nicht aus erfundenen Beispielwerten:
 *
 *   ARCHITECTURE  Durchsetzungskette Intent → Policy → Authorization →
 *                 Execution Gate → Broker → Isolated Runtime → Evidence mit
 *                 Live-Zählern je Stufe
 *   FLOW          Creator → Mission → Objective → Task → Agent → Sandbox → Run
 *   TIMELINE      die letzten echten Ereignisse aus dem Event-Log
 *   STATE_MACHINE Fehler-Lebenszyklus mit den real erlaubten Übergängen und den
 *                 aktuellen Vorkommen je Zustand
 *   DEPENDENCY    Runtime-Registry-Matrix (Art, Plattformen, Netzwerk-Default)
 *   NETWORK       Netzwerk-Politik je Objekt (Sandbox, Gerät, Provider, Computer)
 *   SCENE_3D      axonometrische Projektion der Sandbox-Flotte (Zustände)
 *
 * Sicherheitsgrenzen:
 *  - Jeder eingefügte Wert wird XML-escaped; danach prüft `assertPassiveSvg`
 *    zusätzlich auf aktive Inhalte (`<script`, `javascript:`, `on…=`-Attribute,
 *    `<!ENTITY`, `<?xml-stylesheet`). Ein Verstoß bricht das Rendern ab —
 *    fail closed statt „SVG mit Skript".
 *  - Die Ausgabe ist größenbegrenzt (weniger Knoten statt abgeschnittener
 *    Zeichnung), damit sie als Evidenz-Artefakt vollständig gespeichert werden
 *    kann.
 *  - Ein Szenario ist eine Annahme, kein Nachweis: der Render trägt das im
 *    Titel („SIMULATION — kein Nachweis") und im Ereignisstrom.
 */

export type RenderKind = "ARCHITECTURE" | "FLOW" | "TIMELINE" | "STATE_MACHINE" | "DEPENDENCY" | "NETWORK" | "SCENE_3D";
export const RENDER_KINDS: RenderKind[] = ["ARCHITECTURE", "FLOW", "TIMELINE", "STATE_MACHINE", "DEPENDENCY", "NETWORK", "SCENE_3D"];

const WIDTH = 960;
const MAX_NODES = 24;
const MAX_LABEL = 42;
/** Anteil von MAX_CONTENT_BYTES, den ein Render höchstens belegen darf. */
const MAX_SVG_BYTES = Math.floor(MAX_CONTENT_BYTES * 0.75);

const escapeXml = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] as string);

const clip = (value: unknown, max = MAX_LABEL): string => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
};

/**
 * Defense in Depth: selbst wenn eine Escaping-Lücke entstünde, darf kein
 * ausführbarer Inhalt das Haus verlassen. Geprüft wird der fertige String.
 */
export function assertPassiveSvg(svg: string): void {
  // Attribute dürfen nur **innerhalb von Markup** verboten sein: ein Szenario
  // darf „onload=" heißen (das steht dann als escapter Text im Bild). Deshalb
  // werden Attributprüfungen auf die Tag-Innenräume angewandt, nicht auf den
  // ganzen String — sonst schlägt der Schutz bei harmlosen Beschriftungen zu
  // und wäre in der Praxis nicht haltbar.
  const tags = (svg.match(/<[^>]*>/g) ?? []).join(" ");
  const global: Array<[string, RegExp]> = [
    ["Skriptelement", /<script/i],
    ["Skript-URL", /javascript:/i],
    ["Entität", /<!ENTITY/i],
    ["Stylesheet-Anweisung", /<\?xml-stylesheet/i],
    ["Fremdobjekt", /<(?:iframe|object|embed|foreignObject)\b/i],
    ["Daten-URL", /data:text\/html/i]
  ];
  const inTag: Array<[string, RegExp]> = [
    ["Ereignis-Attribut", /\son[a-z]+\s*=/i],
    ["Externe Referenz", /(?:href|src)\s*=\s*["']?(?:https?:)?\/\//i]
  ];
  for (const [label, pattern] of global) {
    if (pattern.test(svg)) throw new Error(`visualization refused: ${label} in rendered SVG`);
  }
  for (const [label, pattern] of inTag) {
    if (pattern.test(tags)) throw new Error(`visualization refused: ${label} in rendered SVG`);
  }
}

type Scenario = ReturnType<typeof listScenarios>[number];
type Node = {x: number; y: number; w: number; h: number; title: string; detail?: string};
type Edge = {from: number; to: number; label?: string};

/** Kopfzeile: welches Szenario wird gezeigt — ohne diesen Bezug wäre der Render anonym. */
const scenarioLabel = (scenario: Scenario): string => `Szenario ${scenario.id} „${clip(scenario.name, 60)}" (${scenario.state})`;

function svgDocument(title: string, subtitle: string, body: string, height: number, contextLine: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" role="img" aria-label="${escapeXml(title)}">`,
    `<title>${escapeXml(title)}</title>`,
    `<desc>${escapeXml(subtitle)}</desc>`,
    `<style>text{font-family:ui-sans-serif,system-ui,sans-serif;fill:#0f172a}rect{fill:#f8fafc;stroke:#334155;stroke-width:1}.t{font-size:13px;font-weight:600}.d{font-size:11px;fill:#475569}.e{stroke:#64748b;stroke-width:1.5;fill:none}.l{font-size:10px;fill:#475569}.h{font-size:16px;font-weight:700}.s{font-size:11px;fill:#64748b}</style>`,
    `<rect x="0" y="0" width="${WIDTH}" height="${height}" fill="#ffffff" stroke="none"/>`,
    `<text class="h" x="16" y="26">${escapeXml(clip(title, 90))}</text>`,
    `<text class="s" x="16" y="44">${escapeXml(clip(subtitle, 140))}</text>`,
    `<text class="s" x="16" y="62">${escapeXml(clip(contextLine, 150))}</text>`,
    `<g transform="translate(0,24)">${body}</g>`,
    `</svg>`
  ].join("");
}

function drawNodes(nodes: Node[], edges: Edge[]): {body: string; height: number} {
  const lines = edges
    .filter(edge => nodes[edge.from] && nodes[edge.to])
    .map(edge => {
      const a = nodes[edge.from];
      const b = nodes[edge.to];
      const label = edge.label ? `<text class="l" x="${(a.x + a.w / 2 + b.x + b.w / 2) / 2}" y="${(a.y + b.y) / 2 - 6}">${escapeXml(clip(edge.label, 24))}</text>` : "";
      return `<path class="e" d="M${a.x + a.w / 2} ${a.y + a.h} L${b.x + b.w / 2} ${b.y}"/>${label}`;
    })
    .join("");
  const boxes = nodes
    .map(node =>
      [
        `<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="6"/>`,
        `<text class="t" x="${node.x + 10}" y="${node.y + 22}">${escapeXml(clip(node.title, 34))}</text>`,
        node.detail ? `<text class="d" x="${node.x + 10}" y="${node.y + 40}">${escapeXml(clip(node.detail, 44))}</text>` : ""
      ].join("")
    )
    .join("");
  const bottom = nodes.reduce((max, node) => Math.max(max, node.y + node.h), 60);
  return {body: lines + boxes, height: bottom + 26};
}

/** Ein Bild mit festem Raster; bei Überlast wird gekürzt statt überzeichnet. */
function gridNodes(entries: Array<{title: string; detail?: string}>, columns: number, boxWidth: number, boxHeight: number, gapX: number, gapY: number, startY = 62): Node[] {
  return entries.slice(0, MAX_NODES).map((entry, index) => ({
    x: 20 + (index % columns) * (boxWidth + gapX),
    y: startY + Math.floor(index / columns) * (boxHeight + gapY),
    w: boxWidth,
    h: boxHeight,
    title: entry.title,
    detail: entry.detail
  }));
}

function bar(label: string, value: string, y: number, ratio: number): string {
  const width = Math.max(2, Math.round(420 * Math.max(0, Math.min(1, ratio))));
  return [
    `<text class="t" x="20" y="${y}">${escapeXml(clip(label, 40))}</text>`,
    `<rect x="20" y="${y + 8}" width="420" height="12" rx="3"/>`,
    `<rect x="20" y="${y + 8}" width="${width}" height="12" rx="3" fill="#2563eb" stroke="none"/>`,
    `<text class="d" x="452" y="${y + 18}">${escapeXml(value)}</text>`
  ].join("");
}

/* --------------------------------------------------------------- Renderwege */

type RenderContext = {
  scenarios: ReturnType<typeof listScenarios>;
  control: ReturnType<typeof controlSnapshot>;
  sandboxes: ReturnType<typeof listSandboxes>;
  runs: ReturnType<typeof listRuns>;
  incidents: ReturnType<typeof listErrorIncidents>;
  events: ReturnType<typeof listDomainEvents>;
  tokens: ReturnType<typeof capabilityTokenViews>;
  edges: ReturnType<typeof authorityGraph>;
  runtimes: ReturnType<typeof listRuntimes>;
  computers: ReturnType<typeof listComputers>;
  devices: ReturnType<typeof listDevices>;
  providers: ReturnType<typeof listProviders>;
};

function context(): RenderContext {
  return {
    scenarios: listScenarios(),
    control: controlSnapshot(),
    sandboxes: listSandboxes(),
    runs: listRuns(),
    incidents: listErrorIncidents(),
    events: listDomainEvents({order: "desc", limit: 12}),
    tokens: capabilityTokenViews(),
    edges: authorityGraph(),
    runtimes: listRuntimes(),
    computers: listComputers(),
    devices: listDevices(),
    providers: listProviders()
  };
}

function architecture(c: RenderContext, scenario: Scenario) {
  const stages: Array<{title: string; detail: string}> = [
    {title: "Intent", detail: `${c.control.missions.length} Missionen · ${c.control.objectives.length} Objectives`},
    {title: "Policy", detail: `${c.edges.length} Autoritätskanten · Privacy DENY`},
    {title: "Authorization", detail: `${c.tokens.length} Capability-Token`},
    {title: "Execution Gate", detail: `${c.control.tasks.length} Tasks · ${c.control.approvals.length} Freigaben`},
    {title: "Broker", detail: `${c.runs.length} Runs`},
    {title: "Isolated Runtime", detail: `${c.sandboxes.length} Sandboxes · Netzwerk DENY`},
    {title: "Evidence", detail: `${c.control.events.length} Ereignisse`}
  ];
  const nodes = gridNodes(stages, 4, 220, 62, 16, 26);
  const edges: Edge[] = nodes.slice(1).map((_, index) => ({from: index, to: index + 1}));
  const drawn = drawNodes(nodes, edges);
  return svgDocument(
    "Durchsetzungskette (echter Plattformzustand)",
    "Intent → Policy → Authorization → Execution Gate → Broker → Isolated Runtime → Evidence · SIMULATION — kein Nachweis",
    drawn.body,
    drawn.height + 24,
    scenarioLabel(scenario)
  );
}

function flow(c: RenderContext, scenario: Scenario) {
  const chain: Array<{title: string; detail: string}> = [
    {title: "Creator", detail: `${c.tokens.filter(token => token.issuedBy === "CREATOR").length} Creator-Ausstellungen`},
    {title: "Mission", detail: `${c.control.missions.length} vorhanden`},
    {title: "Objective", detail: `${c.control.objectives.length} vorhanden`},
    {title: "Task", detail: `${c.control.tasks.length} vorhanden`},
    {title: "Agent", detail: `${c.control.agents.length} Rollen`},
    {title: "Sandbox", detail: `${c.sandboxes.length} isoliert`},
    {title: "Run", detail: `${c.runs.length} Läufe`},
    {title: "Evidence", detail: `${c.control.events.length} Ereignisse`}
  ];
  const nodes = gridNodes(chain, 4, 220, 62, 16, 26);
  const edges: Edge[] = nodes.slice(1).map((_, index) => ({from: index, to: index + 1}));
  const drawn = drawNodes(nodes, edges);
  return svgDocument(
    "Kette Creator → Evidence (FLOW)",
    "Jede Stufe trägt ihren Live-Zähler · SIMULATION — kein Nachweis",
    drawn.body,
    drawn.height + 24,
    scenarioLabel(scenario)
  );
}

function timeline(c: RenderContext, scenario: Scenario) {
  const entries = c.events.slice(0, 12);
  const rows = entries
    .map((event, index) => {
      const y = 76 + index * 30;
      return [
        `<text class="d" x="20" y="${y}">${escapeXml(event.timestamp.slice(11, 19))}</text>`,
        `<text class="t" x="86" y="${y}">${escapeXml(clip(event.type, 34))}</text>`,
        `<text class="d" x="360" y="${y}">${escapeXml(clip(event.message, 68))}</text>`
      ].join("");
    })
    .join("");
  const height = 76 + Math.max(1, entries.length) * 30 + 16;
  return svgDocument(
    "Ereignis-Zeitachse (echtes Event-Log)",
    `${entries.length} jüngste Ereignisse · Reihenfolge wie im kausalen Log`,
    rows || `<text class="d" x="20" y="76">Keine Ereignisse vorhanden</text>`,
    height + 24,
    scenarioLabel(scenario)
  );
}

function stateMachine(c: RenderContext, scenario: Scenario) {
  const states = Object.keys(ERROR_TRANSITIONS) as Array<keyof typeof ERROR_TRANSITIONS>;
  const counts = new Map<string, number>();
  for (const incident of c.incidents) counts.set(incident.status, (counts.get(incident.status) ?? 0) + 1);
  const entries = states.map(state => ({
    title: state,
    detail: `${counts.get(state) ?? 0} Vorkommen · ${ERROR_TRANSITIONS[state].length} Übergänge`
  }));
  const nodes = gridNodes(entries, 4, 220, 58, 16, 22);
  const edges: Edge[] = [];
  states.forEach((state, from) => {
    for (const target of ERROR_TRANSITIONS[state]) {
      const to = states.indexOf(target);
      if (to >= 0) edges.push({from, to});
    }
  });
  const drawn = drawNodes(nodes, edges);
  return svgDocument(
    "Fehler-Lebenszyklus (erlaubte Übergänge)",
    "Zustände und Übergänge aus der Fehler-Intelligenz, Vorkommen aus den echten Vorfällen",
    drawn.body,
    drawn.height + 24,
    scenarioLabel(scenario)
  );
}

function dependency(c: RenderContext, scenario: Scenario) {
  const entries = c.runtimes.map(runtime => ({
    title: runtime.name,
    detail: `${runtime.kind} · ${runtime.version} · Netz ${runtime.networkDefault} · Sandbox ${runtime.sandboxSupport ? "ja" : "nein"}`
  }));
  const nodes = gridNodes(entries, 3, 300, 58, 16, 22);
  const drawn = drawNodes(nodes, []);
  return svgDocument(
    "Laufzeit-Matrix (Runtime-Registry)",
    `${entries.length} registrierte Laufzeiten · Netzwerk-Default und Sandbox-Unterstützung je Laufzeit`,
    drawn.body,
    drawn.height + 24,
    scenarioLabel(scenario)
  );
}

function network(c: RenderContext, scenario: Scenario) {
  const total = c.sandboxes.length + c.devices.length + c.providers.length + c.computers.length;
  const denied = [
    ...c.sandboxes.filter(sandbox => sandbox.network === "DENY"),
    ...c.devices.filter(device => device.network === "NONE"),
    ...c.providers.filter(provider => !provider.enabled),
    ...c.computers.filter(computer => computer.network === "DENY")
  ].length;
  const bars = [
    bar("Sandboxes ohne Netzwerk", `${c.sandboxes.filter(s => s.network === "DENY").length} / ${c.sandboxes.length}`, 76, c.sandboxes.length ? c.sandboxes.filter(s => s.network === "DENY").length / c.sandboxes.length : 1),
    bar("Geräte ohne Netzwerkpfad", `${c.devices.filter(d => d.network === "NONE").length} / ${c.devices.length}`, 126, c.devices.length ? c.devices.filter(d => d.network === "NONE").length / c.devices.length : 1),
    bar("Provider deaktiviert", `${c.providers.filter(p => !p.enabled).length} / ${c.providers.length}`, 176, c.providers.length ? c.providers.filter(p => !p.enabled).length / c.providers.length : 1),
    bar("Computer ohne Netzwerk", `${c.computers.filter(x => x.network === "DENY").length} / ${c.computers.length}`, 226, c.computers.length ? c.computers.filter(x => x.network === "DENY").length / c.computers.length : 1)
  ].join("");
  const list = [...c.sandboxes.map(sandbox => `${sandbox.sandboxId}:${sandbox.network}`), ...c.providers.map(provider => `${provider.id}:${provider.enabled ? "ENABLED" : "OFF"}`)]
    .slice(0, 8)
    .map((entry, index) => `<text class="d" x="20" y="${292 + index * 18}">${escapeXml(clip(entry, 60))}</text>`)
    .join("");
  return svgDocument(
    "Netzwerk-Politik je Objekt",
    `${denied} von ${total} Objekten ohne externen Pfad · default DENY`,
    `${bars}${list}`,
    292 + Math.min(8, total) * 18 + 44,
    scenarioLabel(scenario)
  );
}

function scene(c: RenderContext, scenario: Scenario) {
  // Axonometrische Projektion: x → rechts unten, y → rechts oben, z → Höhe.
  const entries = c.sandboxes.slice(0, 12);
  const boxes = entries
    .map((sandbox, index) => {
      const gx = index % 4;
      const gy = Math.floor(index / 4);
      const originX = 180 + gx * 170 + gy * 70;
      const originY = 260 + gx * 55 - gy * 60;
      const height = sandbox.lifecycle === "RUNNING" ? 56 : sandbox.lifecycle === "PAUSED" ? 28 : 40;
      const top = `${originX},${originY} ${originX + 90},${originY - 45} ${originX + 180},${originY} ${originX + 90},${originY + 45}`;
      const side = `${originX + 90},${originY + 45} ${originX + 180},${originY} ${originX + 180},${originY - height} ${originX + 90},${originY + 45 - height}`;
      return [
        `<polygon points="${top}" fill="#e2e8f0" stroke="#334155"/>`,
        `<polygon points="${side}" fill="#cbd5e1" stroke="#334155"/>`,
        `<text class="d" x="${originX + 30}" y="${originY + 4}">${escapeXml(clip(sandbox.sandboxId, 18))}</text>`,
        `<text class="d" x="${originX + 30}" y="${originY + 20}">${escapeXml(clip(sandbox.lifecycle, 16))}</text>`
      ].join("");
    })
    .join("");
  return svgDocument(
    "Sandbox-Flotte (axonometrisch)",
    `${entries.length} von ${c.sandboxes.length} Sandboxes · Höhe = Lebenszykluszustand · SIMULATION — kein Nachweis`,
    boxes || `<text class="d" x="20" y="90">Keine Sandboxes vorhanden</text>`,
    444,
    scenarioLabel(scenario)
  );
}

/* ------------------------------------------------------------------ Rendern */

export function renderScenarioSvg(scenarioId: string, kind: RenderKind): {svg: string; kind: RenderKind; scenarioId: string; nodes: number; bytes: number; digest: string} {
  if (!RENDER_KINDS.includes(kind)) throw new Error(`unsupported visualization kind: ${String(kind)}`);
  const c = context();
  const scenario = c.scenarios.find(entry => entry.id === scenarioId);
  if (!scenario) throw new Error("scenario not found");

  const rendered =
    kind === "ARCHITECTURE" ? architecture(c, scenario)
    : kind === "FLOW" ? flow(c, scenario)
    : kind === "TIMELINE" ? timeline(c, scenario)
    : kind === "STATE_MACHINE" ? stateMachine(c, scenario)
    : kind === "DEPENDENCY" ? dependency(c, scenario)
    : kind === "NETWORK" ? network(c, scenario)
    : scene(c, scenario);

  assertPassiveSvg(rendered);
  const bytes = Buffer.byteLength(rendered, "utf8");
  if (bytes > MAX_SVG_BYTES) throw new Error(`visualization too large: ${bytes} bytes (limit ${MAX_SVG_BYTES})`);
  const nodes = (rendered.match(/<rect /g) ?? []).length;
  return {svg: rendered, kind, scenarioId, nodes, bytes, digest: crypto.createHash("sha256").update(rendered, "utf8").digest("hex")};
}

/**
 * Rendert und legt das Ergebnis als Evidenz-Artefakt ab (inkl. Digest, Ereignis
 * und Audit-Gang über `recordArtifact`).
 */
export function renderScenarioArtifact(scenarioId: string, kind: RenderKind, actor = "CREATOR") {
  const result = renderScenarioSvg(scenarioId, kind);
  const scenario = listScenarios().find(entry => entry.id === scenarioId);
  const artifact = recordArtifact(
    {
      name: `Visualisierung ${kind} · ${scenarioId}`,
      kind: "VISUALIZATION",
      taskId: String(scenario?.inputs?.taskId ?? ""),
      runId: "",
      sandboxId: String(scenario?.inputs?.sandboxId ?? ""),
      agentId: "AG-SCIENTIST",
      knowledgeState: "OBSERVED",
      contentType: "image/svg+xml"
    },
    result.svg
  );
  observe({
    type: "visualization.rendered",
    message: `Visualisierung ${kind} gerendert (${result.bytes} Bytes, SHA-256 ${result.digest.slice(0, 12)}…)`,
    status: "COMPLETED",
    actor,
    agentId: actor,
    action: "simulation.render",
    resource: scenarioId,
    argumentsValue: {kind, artifactId: artifact.id, digest: result.digest, bytes: result.bytes}
  });
  return {
    artifactId: artifact.id,
    digest: result.digest,
    kind,
    scenarioId,
    bytes: result.bytes,
    nodes: result.nodes,
    truncated: artifact.truncated,
    svg: result.svg
  };
}

export function visualizationKinds(): RenderKind[] {
  return [...RENDER_KINDS];
}
