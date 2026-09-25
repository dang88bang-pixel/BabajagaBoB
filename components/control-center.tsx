"use client";

import {useCallback, useEffect, useState} from "react";
import type {Agent, Event, Experiment, Mission, Sandbox, Status} from "../lib/types";
import {StatusBadge} from "./status-badge";

/**
 * Control Center (Abschnitt 34/35).
 *
 * Jede Navigationsseite ist an echte Serverdaten gebunden. Fehlt eine Antwort
 * oder ist eine Liste leer, zeigt die Oberfläche das ausdrücklich an
 * („keine Daten“ / „nicht verfügbar“) — es gibt bewusst **keine** Platzhalter-
 * zeile mit erfundenem Zustand wie „READY“. Der Browser erhält ausschließlich
 * das HttpOnly-Session-Cookie; Secrets, Provider-, Geräte- und Runtime-Daten
 * bleiben serverseitig.
 */

const nav = [
  "Overview",
  "Errors",
  "Agents",
  "Missions",
  "Tasks",
  "Queue",
  "Approvals",
  "Apps",
  "Gallery",
  "Experiments",
  "Sandboxes",
  "Tests",
  "Deployments",
  "Artifacts",
  "Security",
  "Integrations",
  "Devices",
  "Knowledge",
  "Simulation",
  "Replay"
] as const;
type Section = (typeof nav)[number];

type TaskRow = {
  taskId: string;
  title: string;
  status: Status;
  progress: number;
  risk: string;
  assignedAgent: string | null;
  requiresApproval: boolean;
};
type Snapshot = {
  agents: Agent[];
  missions: Mission[];
  tasks: TaskRow[];
  experiments: Experiment[];
  sandboxes: Sandbox[];
  events: Event[];
  approvals: {id: string; taskId: string; status: string; reason: string; createdAt?: string}[];
  locked: boolean;
};
type Timeline = {
  timeline: {sequence: number; event: Event}[];
  nodes: {id: string; kind: string; label: string}[];
  edges: {from: string; to: string; relation: string}[];
  integrity: string;
};
type GovernanceStatus = {
  killSwitches: {scope: string; targetId: string; active: boolean}[];
  delegations: {
    id: string;
    from: string;
    to: string;
    capabilities: string[];
    taskId?: string;
    sandboxId?: string;
    expiresAt: string;
    status: string;
  }[];
  integrity: {count: number; active: number; expired: number};
};
type RuntimeStatus = {
  mode: string;
  health: string;
  network: string;
  summary: {total: number; running: number; ready: number; paused: number; failed: number; orphaned: number};
};
type ErrorIncident = {
  id: string;
  timestamp: string;
  status: string;
  severity: string;
  symptom: string;
  incident: string;
  rootCause?: string;
  taskId?: string;
  runId?: string;
  agentId?: string;
  progress?: number;
};
type FabricAgent = {
  agentId: string;
  name: string;
  kind: string;
  status: Status;
  progress: number;
  capabilities: string[];
  maxRisk: string;
  health: string;
  heartbeatAt: string;
  profile: {
    initiative: boolean;
    experimentation: boolean;
    codeChanges: boolean;
    sandboxCreation: boolean;
    externalNetwork: boolean;
    production: boolean;
    infrastructure: boolean;
    authorityChanges: boolean;
  };
};
type Job = {
  jobId: string;
  taskId: string;
  agentId: string;
  state: string;
  attempt: number;
  maxAttempts: number;
  risk: string;
  priority: number;
};
type ApprovalRequest = {id: string; approvalId?: string; taskId: string; status: string; reason: string; createdAt?: string};
type Pipeline = {
  id: string;
  taskId: string;
  branch: string;
  stage: string;
  checks: {kind: string; status: string; summary?: string}[];
  updatedAt?: string;
};
type Artifact = {
  id: string;
  name: string;
  kind: string;
  taskId: string;
  runId: string;
  sandboxId: string;
  agentId: string;
  knowledgeState: string;
  digest: string;
  createdAt: string;
  truncated?: boolean;
};
type Device = {
  id: string;
  name: string;
  os: string;
  arch: string;
  trust: string;
  state: string;
  capabilities: string[];
  network: string;
};
type Computer = {
  id: string;
  name: string;
  kind: string;
  network: string;
  authorized: boolean;
  state: string;
  taskId?: string;
};
type KnowledgeNode = {
  knowledgeId: string;
  layer: string;
  subject: string;
  predicate: string;
  object: string;
  state: string;
  confidence: string;
};
type Scenario = {id: string; name: string; kind: string; state: string; assumptions: string[]; expectedStates: string[]};
type Provider = {id: string; name: string; category: string; lifecycle: string; health: string; enabled: boolean; lastHeartbeat?: string};

type PanelData = {
  jobs: Job[] | null;
  approvals: ApprovalRequest[] | null;
  pipelines: Pipeline[] | null;
  artifacts: Artifact[] | null;
  devices: Device[] | null;
  computers: Computer[] | null;
  knowledge: KnowledgeNode[] | null;
  scenarios: Scenario[] | null;
  fabric: FabricAgent[] | null;
  audit: {records: number; valid: boolean} | null;
  readiness: {ready: boolean; activeTasks: number; blockedTasks: number} | null;
};

const emptyPanel: PanelData = {
  jobs: null,
  approvals: null,
  pipelines: null,
  artifacts: null,
  devices: null,
  computers: null,
  knowledge: null,
  scenarios: null,
  fabric: null,
  audit: null,
  readiness: null
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {cache: "no-store"});
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export default function ControlCenter() {
  const [section, setSection] = useState<Section>("Overview");
  const [data, setData] = useState<Snapshot | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [apps, setApps] = useState<{id: string; name: string; state: string; progress: number; modules: string[]}[]>([]);
  const [gallery, setGallery] = useState<{id: string; timestamp: string; kind: string; title: string; description: string; status: string; actor: string}[]>([]);
  const [capabilities, setCapabilities] = useState<{edges: unknown[]; tokens: unknown[]} | null>(null);
  const [errorIncidents, setErrorIncidents] = useState<ErrorIncident[]>([]);
  const [governance, setGovernance] = useState<GovernanceStatus | null>(null);
  const [providerList, setProviderList] = useState<Provider[]>([]);
  const [panels, setPanels] = useState<PanelData>(emptyPanel);
  const [verifyResult, setVerifyResult] = useState<string>("");
  const [error, setError] = useState("");
  const [auth, setAuth] = useState<{authenticated: boolean; requiresBootstrap: boolean; revoked: boolean; loginAvailable?: boolean; locked?: boolean} | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  const load = useCallback(async () => {
    try {
      const [control, tl, caps, appRes, gal, rt, errRes, gov] = await Promise.all([
        fetch("/api/control", {cache: "no-store"}),
        fetch("/api/timeline", {cache: "no-store"}),
        fetch("/api/capabilities", {cache: "no-store"}),
        fetch("/api/apps", {cache: "no-store"}),
        fetch("/api/gallery", {cache: "no-store"}),
        fetch("/api/runtime", {cache: "no-store"}),
        fetch("/api/errors", {cache: "no-store"}),
        fetch("/api/governance", {cache: "no-store"})
      ]);
      if (!control.ok) {
        const status = control.status;
        if (status === 401 || status === 423 || status === 428) {
          const authState = await getJson<{authenticated?: boolean; requiresBootstrap?: boolean; revoked?: boolean; loginAvailable?: boolean; locked?: boolean}>( "/api/auth");
          setAuth({
            authenticated: Boolean(authState?.authenticated),
            requiresBootstrap: Boolean(authState?.requiresBootstrap),
            revoked: Boolean(authState?.revoked),
            loginAvailable: Boolean(authState?.loginAvailable),
            locked: Boolean(authState?.locked)
          });
          setAuthError(status === 428 ? "System nicht initialisiert – Creator-Bootstrap erforderlich." : status === 423 ? "Root Authority widerrufen – System ist fail closed." : "Session abgelaufen oder nicht vorhanden.");
          return;
        }
        throw new Error(`Control Plane nicht erreichbar (HTTP ${status})`);
      }
      setData((await control.json()) as Snapshot);
      setTimeline(tl.ok ? ((await tl.json()) as Timeline) : null);
      setCapabilities(caps.ok ? ((await caps.json()) as {edges: unknown[]; tokens: unknown[]}) : null);
      setApps(appRes.ok ? ((await appRes.json()) as {apps: {id: string; name: string; state: string; progress: number; modules: string[]}[]}).apps : []);
      setGallery(gal.ok ? ((await gal.json()) as {entries: {id: string; timestamp: string; kind: string; title: string; description: string; status: string; actor: string}[]}).entries : []);
      setRuntime(rt.ok ? ((await rt.json()) as RuntimeStatus) : null);
      setErrorIncidents(errRes.ok ? ((await errRes.json()) as {incidents: ErrorIncident[]}).incidents : []);
      setGovernance(gov.ok ? ((await gov.json()) as GovernanceStatus) : null);

      const [fabric, jobs, approvals, pipelines, artifacts, devices, computers, knowledge, simulation, providers, audit, readiness] = await Promise.all([
        getJson<{agents: FabricAgent[]}>("/api/agents/fabric"),
        getJson<{jobs: Job[]}>("/api/queue"),
        getJson<ApprovalRequest[] | {requests: ApprovalRequest[]}>("/api/approvals"),
        getJson<{pipelines: Pipeline[]}>("/api/cicd"),
        getJson<{artifacts: Artifact[]}>("/api/artifacts"),
        getJson<{devices: Device[]}>("/api/devices"),
        getJson<{computers: Computer[]}>("/api/computer-use"),
        getJson<{nodes: KnowledgeNode[]}>("/api/knowledge"),
        getJson<{scenarios: Scenario[]}>("/api/simulation"),
        getJson<{providers: Provider[]}>("/api/providers"),
        getJson<{records: unknown[]; chain: {valid: boolean}}>("/api/audit"),
        getJson<{ready: boolean; activeTasks: number; blockedTasks: number}>("/api/readiness")
      ]);
      setProviderList(providers?.providers ?? []);
      setPanels({
        jobs: jobs?.jobs ?? null,
        approvals: Array.isArray(approvals) ? approvals : (approvals?.requests ?? null),
        pipelines: pipelines?.pipelines ?? null,
        artifacts: artifacts?.artifacts ?? null,
        devices: devices?.devices ?? null,
        computers: computers?.computers ?? null,
        knowledge: knowledge?.nodes ?? null,
        scenarios: simulation?.scenarios ?? null,
        fabric: fabric?.agents ?? null,
        audit: audit ? {records: audit.records.length, valid: Boolean(audit.chain?.valid)} : null,
        readiness: readiness ?? null
      });
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unbekannter Fehler");
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 2000);
    return () => clearInterval(id);
  }, [load]);

  const action = async (body: object) => {
    await fetch("/api/control", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
    await load();
  };
  const verifyArtifact = async (id: string) => {
    const result = await getJson<{verification: {ok: boolean; expected?: string; actual?: string; error?: string}}>(`/api/artifacts?verify=${encodeURIComponent(id)}`);
    setVerifyResult(result ? `${id}: ${result.verification.ok ? "Digest bestätigt" : `Prüfung fehlgeschlagen (${result.verification.error ?? "Digest weicht ab"})`}` : `${id}: Prüfung nicht möglich`);
  };

  const locked = Boolean(data?.locked);
  const agents = data?.agents ?? [];
  const missions = data?.missions ?? [];
  const tasks = data?.tasks ?? [];
  const experiments = data?.experiments ?? [];
  const sandboxes = data?.sandboxes ?? [];
  const approvals = data?.approvals ?? [];
  const title = section === "Overview" ? "Control Center" : section;
  const avg = Math.round([...agents, ...tasks, ...experiments].reduce((sum, item) => sum + item.progress, 0) / Math.max(1, [...agents, ...tasks, ...experiments].length));
  const taskTitle = (taskId: string | null | undefined) => tasks.find(task => task.taskId === taskId)?.title ?? "—";

  const submitAuth = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setAuthBusy(true);
    setAuthError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({action: "bootstrap", secret: String(form.get("secret") ?? ""), creatorName: String(form.get("creatorName") ?? "")})
      });
      const out = (await response.json().catch(() => ({}))) as {message?: string};
      if (!response.ok) {
        setAuthError(String(out.message ?? "Bootstrap verweigert"));
        return;
      }
      setAuth({authenticated: true, requiresBootstrap: false, revoked: false});
      await load();
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : "Bootstrap fehlgeschlagen");
    } finally {
      setAuthBusy(false);
    }
  };

  const submitLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setAuthBusy(true);
    setAuthError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({action: "login", secret: String(form.get("secret") ?? ""), totpCode: String(form.get("totpCode") ?? "") || undefined})
      });
      const out = (await response.json().catch(() => ({}))) as {message?: string; code?: string};
      if (!response.ok) {
        setAuthError(String(out.message ?? out.code ?? "Anmeldung verweigert"));
        setAuth(current => ({authenticated: false, requiresBootstrap: false, revoked: Boolean(current?.revoked), loginAvailable: Boolean(current?.loginAvailable), locked: response.status === 423}));
        return;
      }
      setAuth({authenticated: true, requiresBootstrap: false, revoked: false, loginAvailable: true, locked: false});
      await load();
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : "Anmeldung fehlgeschlagen");
    } finally {
      setAuthBusy(false);
    }
  };

  if (auth && !auth.authenticated)
    return (
      <main className="shell">
        <section className="content">
          <header>
            <div>
              <small>SERVER-AUTHENTIFIZIERUNG</small>
              <h1>Creator-Zugang</h1>
            </div>
            <div className="headerActions">
              <span className="privacy">SESSION · HTTPONLY</span>
            </div>
          </header>
          <section className="panel sectionPanel">
            <small>BOOTSTRAP / SESSION</small>
            <h2>{auth.revoked ? "Root Authority widerrufen" : "Creator-Bootstrap"}</h2>
            <p>
              Die Control Plane arbeitet ausschließlich mit serverseitigen Sessions. Das Control-Center erhält nur ein HttpOnly-Cookie – niemals Root-,
              Provider-, Geräte- oder Runtime-Secrets.
            </p>
            {auth.revoked ? (
              <div className="integrity">
                <strong>FAIL CLOSED</strong>
                <span>Root Authority wurde widerrufen. Re-Bootstrap ist standardmäßig deaktiviert.</span>
              </div>
            ) : auth.requiresBootstrap ? (
              <form onSubmit={submitAuth}>
                <label>
                  Creator-Name
                  <input name="creatorName" required minLength={2} defaultValue="Creator" />
                </label>
                <label>
                  Bootstrap-Secret
                  <input name="secret" type="password" required autoComplete="off" />
                </label>
                <button type="submit" disabled={authBusy}>
                  {authBusy ? "Prüfe…" : "Bootstrap abschließen"}
                </button>
                {authError && <small>{authError}</small>}
              </form>
            ) : auth.loginAvailable ? (
              <form onSubmit={submitLogin}>
                <label>
                  Creator-Secret
                  <input name="secret" type="password" required autoComplete="off" disabled={Boolean(auth.locked)} />
                </label>
                <label>
                  Zweiter Faktor (TOTP, nur falls konfiguriert)
                  <input name="totpCode" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="one-time-code" disabled={Boolean(auth.locked)} />
                </label>
                <button type="submit" disabled={authBusy || Boolean(auth.locked)}>
                  {authBusy ? "Prüfe…" : auth.locked ? "Gesperrt (zu viele Fehlversuche)" : "Als Creator anmelden"}
                </button>
                <small>
                  Server-seitiges Secret: Datei <code>&lt;BOB_STORAGE_DIR&gt;/creator-token</code> (0600) oder <code>BOB_CREATOR_LOGIN_SECRET</code>. Das
                  Secret verlässt den Server nie.
                </small>
                {authError && <small>{authError}</small>}
              </form>
            ) : (
              <div className="integrity">
                <strong>SESSION ERFORDERLICH</strong>
                <span>{authError || "Kein Creator-Anmeldeweg konfiguriert."}</span>
              </div>
            )}
          </section>
        </section>
      </main>
    );

  const panel = () => {
    switch (section) {
      case "Overview":
        return (
          <>
            <div className="metrics">
              {[
                {k: "Agents", v: String(agents.length).padStart(2, "0"), s: `${agents.filter(agent => ["RUNNING", "EXECUTING"].includes(agent.status)).length} aktiv`},
                {k: "Progress", v: `${avg}%`, s: "laufende Arbeit"},
                {k: "Tasks", v: String(tasks.length).padStart(2, "0"), s: `${tasks.filter(task => task.status === "RUNNING").length} laufend`},
                {k: "Experimente", v: String(experiments.length).padStart(2, "0"), s: `${experiments.filter(experiment => experiment.status === "EXPERIMENT").length} aktiv`},
                {k: "Freigaben", v: String(approvals.filter(approval => approval.status === "PENDING").length).padStart(2, "0"), s: "offen"}
              ].map(metric => (
                <div className="metric" key={metric.k}>
                  <small>{metric.k}</small>
                  <strong>{metric.v}</strong>
                  <span>{metric.s}</span>
                </div>
              ))}
            </div>
            <div className="grid">
              <section className="panel">
                <div className="panelHead">
                  <div>
                    <small>LIVE OBSERVATORY</small>
                    <h2>Agents</h2>
                  </div>
                  <span className="live">● LIVE</span>
                </div>
                {agents.length === 0 && <Empty text="Keine Agenten geladen." />}
                {agents.map(agent => (
                  <div className="agent" key={agent.agentId}>
                    <div className="avatar">{agent.name[0]}</div>
                    <div className="agentMain">
                      <div className="agentTitle">
                        <b>{agent.name}</b>
                        <span>{agent.role}</span>
                        <StatusBadge status={agent.status} />
                      </div>
                      <div className="bar">
                        <i style={{width: `${agent.progress}%`}} />
                      </div>
                      <small>
                        {agent.agentId} · {agent.kind} · {agent.progress}% · Health {agent.health}
                      </small>
                    </div>
                  </div>
                ))}
              </section>
              <section className="panel">
                <div className="panelHead">
                  <div>
                    <small>EVENT FABRIC</small>
                    <h2>Live Timeline</h2>
                  </div>
                  <button onClick={() => void action({action: "guardian"})} disabled={locked}>
                    Guardian Check
                  </button>
                </div>
                {(timeline?.timeline ?? []).slice(-12).reverse().map(entry => (
                  <div className="event" key={entry.event.id}>
                    <StatusBadge status={entry.event.status} />
                    <div>
                      <b>{entry.event.type}</b>
                      <span>{entry.event.message}</span>
                      <small>
                        #{entry.sequence} · {entry.event.actor} · {entry.event.time}
                      </small>
                    </div>
                  </div>
                ))}
                {(timeline?.timeline ?? []).length === 0 && <Empty text="Keine Ereignisse vorhanden." />}
                {runtime && (
                  <div className="integrity">
                    <strong>RUNTIME {runtime.mode}</strong>
                    <span>
                      {runtime.health} · Netzwerk {runtime.network} · {runtime.summary.running} laufend / {runtime.summary.total} Sandboxes
                    </span>
                  </div>
                )}
              </section>
            </div>
          </>
        );
      case "Errors":
        return <Errors incidents={errorIncidents} />;
      case "Agents":
        return (
          <Table
            title="Agents"
            subtitle="Autonomie-Vertrag je Rolle: keine Selbstvergabe, kein Produktionszugriff, kein externer Netzwerkzugriff."
            head={["Agent", "Rolle", "Status", "Fortschritt", "Capabilities", "Risiko", "Grenzen"]}
            rows={agents.map(agent => {
              const fabricAgent = panels.fabric?.find(entry => entry.agentId === agent.agentId);
              const profile = fabricAgent?.profile;
              const bounds = profile
                ? [profile.production ? "PRODUCTION" : null, profile.authorityChanges ? "AUTHORITY" : null, profile.externalNetwork ? "EXTERNAL_NET" : null, profile.infrastructure ? "INFRA" : null].filter(Boolean).join(" · ") || "keine Zusatzrechte"
                : "nicht verfügbar";
              return [agent.agentId, `${agent.name} (${agent.kind})`, agent.status, `${agent.progress}%${fabricAgent ? "" : " (Fabric nicht verfügbar)"}`, (fabricAgent?.capabilities ?? []).join(", ") || "—", fabricAgent?.maxRisk ?? "—", bounds];
            })}
            empty="Keine Agenten geladen."
          />
        );
      case "Missions":
        return (
          <Table
            title="Missions"
            subtitle="Missionen der Control Plane."
            head={["Mission", "Titel", "Status", "Fortschritt", "Owner", "Objectives"]}
            rows={missions.map(mission => [mission.missionId, mission.title, mission.status, `${mission.progress}%`, mission.owner, mission.objective || "—"])}
            empty="Keine Missionen vorhanden."
          />
        );
      case "Tasks":
        return (
          <Table
            title="Tasks"
            subtitle="Aufgaben mit Risiko, Zuweisung und Freigabepflicht."
            head={["Task", "Titel", "Status", "Fortschritt", "Risiko", "Agent", "Freigabe"]}
            rows={tasks.map(task => [task.taskId, task.title, task.status, `${task.progress}%`, task.risk, task.assignedAgent ?? "—", task.requiresApproval ? "erforderlich" : "nein"])}
            empty="Keine Aufgaben vorhanden."
          />
        );
      case "Queue":
        return (
          <Table
            title="Queue"
            subtitle="Leases, Versuche und Idempotenzschlüssel der Ausführungswarteschlange."
            head={["Job", "Task", "Agent", "Status", "Versuche", "Risiko", "Priorität"]}
            rows={(panels.jobs ?? []).map(job => [job.jobId, `${job.taskId} (${taskTitle(job.taskId)})`, job.agentId, job.state, `${job.attempt}/${job.maxAttempts}`, job.risk, String(job.priority)])}
            empty={panels.jobs === null ? "nicht verfügbar" : "Warteschlange ist leer."}
          />
        );
      case "Approvals":
        return (
          <Table
            title="Approvals"
            subtitle="Freigaben werden ausschließlich serverseitig entschieden; die Oberfläche zeigt nur den Zustand."
            head={["Freigabe", "Task", "Status", "Grund", "erstellt"]}
            rows={(panels.approvals ?? approvals).map(approval => [approval.id, `${approval.taskId} (${taskTitle(approval.taskId)})`, approval.status, approval.reason, approval.createdAt ?? "—"])}
            empty={panels.approvals === null ? "nicht verfügbar" : "Keine Freigaben offen."}
          />
        );
      case "Apps":
        return (
          <section className="panel sectionPanel">
            <small>APPLICATION MANAGEMENT</small>
            <h2>Apps</h2>
            <p>Ausführbare Module werden erst nach Tests, Sicherheitsvalidierung und ausdrücklicher Bestätigung aktiv.</p>
            {apps.length === 0 && <Empty text="Keine App-Module registriert." />}
            <div className="moduleGrid">
              {apps.map(app => (
                <div className="moduleCard" key={app.id}>
                  <b>{app.name}</b>
                  <span className="badge">{app.state}</span>
                  <small>
                    {app.id} · {app.progress}% · {app.modules.length} Module
                  </small>
                </div>
              ))}
            </div>
          </section>
        );
      case "Gallery":
        return (
          <section className="panel sectionPanel">
            <small>TRANSPARENT CREATION GALLERY</small>
            <h2>Gallery / Reconstruction</h2>
            <p>Jeder Erstellungsschritt ist zeitgestempelt und für die spätere Fehlerrekonstruktion erhalten.</p>
            {gallery.length === 0 && <Empty text="Keine Galerie-Einträge vorhanden." />}
            {gallery.slice(0, 100).map(entry => (
              <div className="event" key={entry.id}>
                <StatusBadge status={entry.status as Status} />
                <div>
                  <b>{entry.kind}</b>
                  <span>{entry.title}</span>
                  <small>
                    {entry.description} · {entry.timestamp} · {entry.actor}
                  </small>
                </div>
              </div>
            ))}
          </section>
        );
      case "Experiments":
        return (
          <Table
            title="Experiments"
            subtitle="Experimente mit Hypothesenstatus; die Validierung erfolgt über Kausalitätsregeln, nicht über Vermutungen."
            head={["Experiment", "Titel", "Status", "Fortschritt", "Wissenszustand", "Sandbox", "Hypothese"]}
            rows={experiments.map(experiment => [experiment.experimentId, experiment.title, experiment.status, `${experiment.progress}%`, experiment.knowledgeState, experiment.sandboxId ?? "—", experiment.hypothesis ?? "—"])}
            empty="Keine Experimente vorhanden."
          />
        );
      case "Sandboxes":
        return (
          <Table
            title="Sandboxes"
            subtitle={runtime ? `Runtime ${runtime.mode} · Netzwerk ${runtime.network} · ${runtime.summary.running}/${runtime.summary.total} laufend` : "Runtime-Status nicht verfügbar"}
            head={["Sandbox", "Typ", "Status", "Netzwerk", "Task", "Agent", "Runtime"]}
            rows={sandboxes.map(sandbox => [sandbox.sandboxId, sandbox.type, sandbox.status, sandbox.network, `${sandbox.taskId} (${taskTitle(sandbox.taskId)})`, sandbox.agentId, sandbox.runtimeMode ?? "—"])}
            empty="Keine Sandboxes vorhanden."
          />
        );
      case "Tests":
        return (
          <Table
            title="Tests"
            subtitle="Prüfungen der Pipeline und Regressionstests aus der Fehlerkette (Never Again)."
            head={["Pipeline", "Task", "Branch", "Stufe", "Prüfungen", "Zuletzt"]}
            rows={(panels.pipelines ?? []).map(pipeline => [
              pipeline.id,
              `${pipeline.taskId} (${taskTitle(pipeline.taskId)})`,
              pipeline.branch,
              pipeline.stage,
              pipeline.checks.length === 0 ? "keine Prüfung erfasst" : pipeline.checks.map(check => `${check.kind}:${check.status}`).join(", "),
              pipeline.updatedAt ?? "—"
            ])}
            empty={panels.pipelines === null ? "nicht verfügbar" : "Keine Pipelines angelegt."}
            footer="Regressionstests sind je Fehlerfall im Modul Errors sichtbar (Feld Regression); eine Promotion blockiert ohne bestandene Prüfungen."
          />
        );
      case "Deployments":
        return (
          <Table
            title="Deployments"
            subtitle="Promotion-Stufen der Pipeline. Produktionsfreigabe ist ausschließlich Creator-gebunden und wird serverseitig geprüft."
            head={["Pipeline", "Task", "Branch", "Stufe", "Bestandene Prüfungen", "Freigabe"]}
            rows={(panels.pipelines ?? []).map(pipeline => [
              pipeline.id,
              pipeline.taskId,
              pipeline.branch,
              pipeline.stage,
              String(pipeline.checks.filter(check => check.status === "PASSED").length) + "/" + String(pipeline.checks.length),
              pipeline.stage === "PRODUCTION" ? "Produktion freigegeben" : "nicht freigegeben"
            ])}
            empty={panels.pipelines === null ? "nicht verfügbar" : "Keine Deployments/Pipelines vorhanden."}
          />
        );
      case "Artifacts":
        return (
          <>
            <Table
              title="Artifacts / Evidenz"
              subtitle="Digest-gebundene Ausführungsnachweise (SHA-256, serverseitig berechnet)."
              head={["Artefakt", "Art", "Task", "Sandbox", "Agent", "Wissenszustand", "Digest", "Prüfung"]}
              rows={(panels.artifacts ?? []).map(artifact => [
                artifact.id,
                artifact.kind,
                `${artifact.taskId} (${taskTitle(artifact.taskId)})`,
                artifact.sandboxId || "—",
                artifact.agentId,
                artifact.knowledgeState,
                `${artifact.digest.slice(0, 16)}…${artifact.truncated ? " (gekürzt)" : ""}`,
                "prüfen"
              ])}
              onCell={(rowIndex, columnIndex) => {
                if (columnIndex !== 7) return null;
                const artifact = (panels.artifacts ?? [])[rowIndex];
                if (!artifact) return null;
                return (
                  <button type="button" onClick={() => void verifyArtifact(artifact.id)}>
                    prüfen
                  </button>
                );
              }}
              empty={panels.artifacts === null ? "nicht verfügbar" : "Keine Artefakte vorhanden."}
            />
            {verifyResult && <div className="integrity"><strong>DIGEST-PRÜFUNG</strong><span>{verifyResult}</span></div>}
          </>
        );
      case "Security":
        return (
          <>
            <div className="metrics">
              {[
                {k: "Audit", v: panels.audit ? String(panels.audit.records) : "—", s: panels.audit ? (panels.audit.valid ? "Kette integer" : "Kette ungültig") : "nicht verfügbar"},
                {k: "Capability-Token", v: String(capabilities?.tokens.length ?? 0), s: `${capabilities?.edges.length ?? 0} Authority-Kanten`},
                {k: "Delegationen", v: String(governance?.integrity.active ?? 0), s: `${governance?.integrity.expired ?? 0} abgelaufen`},
                {k: "Kill-Switches", v: String((governance?.killSwitches ?? []).length), s: `${(governance?.killSwitches ?? []).filter(entry => entry.active).length} aktiv`},
                {k: "Bereitschaft", v: panels.readiness ? (panels.readiness.ready ? "READY" : "BLOCKED") : "—", s: panels.readiness ? `${panels.readiness.activeTasks} aktive Aufgaben` : "nicht verfügbar"}
              ].map(metric => (
                <div className="metric" key={metric.k}>
                  <small>{metric.k}</small>
                  <strong>{metric.v}</strong>
                  <span>{metric.s}</span>
                </div>
              ))}
            </div>
            <Table
              title="Kill-Switches"
              subtitle="Not-Aus greift auf den gesamten Ausführungspfad (Gate, Broker, Runtime)."
              head={["Scope", "Ziel", "Zustand"]}
              rows={(governance?.killSwitches ?? []).map(entry => [entry.scope, entry.targetId, entry.active ? "AKTIV – Ausführung gesperrt" : "inaktiv"])}
              empty="keine Kill-Switches gemeldet"
            />
            <Table
              title="Delegationen"
              subtitle="Jede Delegation ist an Aufgabe, Sandbox und Ablaufzeit gebunden."
              head={["Delegation", "Von", "An", "Capabilities", "Task", "Sandbox", "Status", "Ablauf"]}
              rows={(governance?.delegations ?? []).map(entry => [entry.id, entry.from, entry.to, entry.capabilities.join(", "), entry.taskId ?? "—", entry.sandboxId ?? "—", entry.status, entry.expiresAt])}
              empty="keine Delegationen vorhanden"
            />
          </>
        );
      case "Integrations":
        return (
          <Table
            title="Integrations / Provider"
            subtitle="Provider-Fabric: Registrierung, Bindung und Health. Verbindungen benötigen eine Creator-Freigabe."
            head={["Provider", "Name", "Kategorie", "Lebenszyklus", "Health", "Aktiv", "Letzter Heartbeat"]}
            rows={providerList.map(provider => [provider.id, provider.name, provider.category, provider.lifecycle, provider.health, provider.enabled ? "ja" : "nein", provider.lastHeartbeat ?? "nie"])}
            empty="Keine Provider registriert."
          />
        );
      case "Devices":
        return (
          <>
            <Table
              title="Geräte"
              subtitle="Entdeckung ist keine Autorisierung: Geräte bleiben bis zur ausdrücklichen Freigabe ungenutzt."
              head={["Gerät", "Name", "OS", "Architektur", "Vertrauen", "Zustand", "Netzwerk", "Capabilities"]}
              rows={(panels.devices ?? []).map(device => [device.id, device.name, device.os, device.arch, device.trust, device.state, device.network, device.capabilities.join(", ")])}
              empty={panels.devices === null ? "nicht verfügbar" : "Keine Geräte entdeckt."}
            />
            <Table
              title="Computer Use"
              subtitle="Browser-, Desktop- und CLI-Instanzen mit expliziter Autorisierung."
              head={["Instanz", "Name", "Art", "Netzwerk", "Autorisiert", "Zustand", "Task"]}
              rows={(panels.computers ?? []).map(computer => [computer.id, computer.name, computer.kind, computer.network, computer.authorized ? "ja" : "nein", computer.state, computer.taskId ?? "—"])}
              empty={panels.computers === null ? "nicht verfügbar" : "Keine Computer-Use-Instanzen registriert."}
            />
          </>
        );
      case "Knowledge":
        return (
          <>
            <Table
              title="Knowledge Graph"
              subtitle="Vier Schichten inklusive negativem Wissen (Never Again). Der Wissenszustand trennt beobachtet, gestützt, etabliert, Hypothese, ungeprüft, widersprochen und verworfen."
              head={["Wissen", "Schicht", "Subjekt", "Prädikat", "Objekt", "Zustand", "Belegklasse"]}
              rows={(panels.knowledge ?? []).map(node => [node.knowledgeId, node.layer, node.subject, node.predicate, node.object, node.state, node.confidence])}
              empty={panels.knowledge === null ? "nicht verfügbar" : "Kein Wissen gespeichert."}
            />
          </>
        );
      case "Simulation":
        return (
          <Table
            title="Simulation / Visualisierung"
            subtitle="Szenarien mit Annahmen und erwarteten Zuständen; Ergebnisse werden als Evidenz geführt."
            head={["Szenario", "Name", "Art", "Zustand", "Annahmen", "Erwartete Zustände"]}
            rows={(panels.scenarios ?? []).map(scenario => [scenario.id, scenario.name, scenario.kind, scenario.state, scenario.assumptions.join(" · ") || "—", scenario.expectedStates.join(" · ") || "—"])}
            empty={panels.scenarios === null ? "nicht verfügbar" : "Keine Szenarien angelegt."}
          />
        );
      case "Replay":
        return (
          <section className="panel sectionPanel">
            <small>CAUSAL REPLAY</small>
            <h2>Time Machine</h2>
            <p>Chronologische Ereignisse mit kausalen Eltern und Provenance-Beziehungen.</p>
            {(timeline?.timeline ?? []).length === 0 && <Empty text="Keine Ereignisse für den Replay vorhanden." />}
            {(timeline?.timeline ?? []).map(entry => (
              <div className="event" key={entry.event.id}>
                <StatusBadge status={entry.event.status} />
                <div>
                  <b>#{entry.sequence} · {entry.event.type}</b>
                  <span>{entry.event.message}</span>
                  <small>
                    {entry.event.actor} · kausaler Elternteil {entry.event.causalParentId ?? "ROOT"}
                  </small>
                </div>
              </div>
            ))}
          </section>
        );
      default:
        return <Empty text="Unbekannter Abschnitt." />;
    }
  };

  return (
    <main className="shell">
      <aside>
        <div className="brand">
          <span>✦</span>
          <div>
            <b>BabajagaBoB</b>
            <small>CONTROL CENTER</small>
          </div>
        </div>
        <nav>
          {nav.map(entry => (
            <button key={entry} onClick={() => setSection(entry)} className={section === entry ? "active" : ""}>
              {entry}
              <span>›</span>
            </button>
          ))}
        </nav>
        <div className="sideStatus">
          <small>SYSTEM</small>
          <StatusBadge status={locked ? "ERROR" : "RUNNING"} />
          <p>{locked ? "EMERGENCY LOCKDOWN" : "Operational · control plane"}</p>
        </div>
      </aside>
      <section className="content">
        <header>
          <div>
            <small>PROJECT / BABAJAGABOB</small>
            <h1>{title}</h1>
          </div>
          <div className="headerActions">
            <span className="privacy">NETZWERK · DENY BY DEFAULT</span>
            <button onClick={() => void action({action: "lockdown", locked: !locked})} className="danger">
              {locked ? "LOCKDOWN AUFHEBEN" : "EMERGENCY LOCKDOWN"}
            </button>
          </div>
        </header>
        {error && <div className="alert">Control Plane: {error}</div>}
        {locked && <div className="alert">Emergency Lockdown aktiv — Ausführung ist angehalten, bis er ausdrücklich aufgehoben wird.</div>}
        {panel()}
      </section>
    </main>
  );
}

function Empty({text}: {text: string}) {
  return <p className="emptyNote">{text}</p>;
}

function Errors({incidents}: {incidents: ErrorIncident[]}) {
  return (
    <section className="panel sectionPanel">
      <small>ERROR INTELLIGENCE</small>
      <h2>Fehlerfälle</h2>
      <p>Lebenszyklus: DETECTED → DIAGNOSING → EXPERIMENTING → ROOT_CAUSE_FOUND → FIXING → VERIFYING → LEARNED → REGRESSION_LOCKED.</p>
      {incidents.length === 0 && <Empty text="Keine Fehlerfälle erfasst." />}
      {incidents.slice(0, 50).map(incident => (
        <div className="experiment" key={incident.id}>
          <StatusBadge status={incident.severity === "CRITICAL" ? "ERROR" : "WAITING"} />
          <div>
            <b>{incident.id}</b>
            <span>{incident.symptom}</span>
            <small>
              {incident.status} · {incident.severity} · Task {incident.taskId ?? "—"} · {incident.rootCause ?? "Ursache nicht ermittelt"}
            </small>
          </div>
        </div>
      ))}
    </section>
  );
}

function Table({
  title,
  subtitle,
  head,
  rows,
  empty,
  footer,
  onCell
}: {
  title: string;
  subtitle: string;
  head: string[];
  rows: string[][];
  empty: string;
  footer?: string;
  onCell?: (rowIndex: number, columnIndex: number) => React.ReactNode;
}) {
  return (
    <section className="panel sectionPanel">
      <small>MODUL / {title.toUpperCase()}</small>
      <h2>{title}</h2>
      <p>{subtitle}</p>
      {rows.length === 0 ? (
        <Empty text={empty} />
      ) : (
        <div className="dataTable">
          <div className="dataRow head">
            {head.map(column => (
              <span key={column}>{column}</span>
            ))}
          </div>
          {rows.map((row, rowIndex) => (
            <div className="dataRow" key={`${row[0]}-${rowIndex}`}>
              {row.map((cell, columnIndex) => (
                <span key={`${columnIndex}-${cell}`} className={columnIndex === 2 ? "state" : ""}>
                  {onCell?.(rowIndex, columnIndex) ?? cell}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
      {footer && <p className="emptyNote">{footer}</p>}
    </section>
  );
}
