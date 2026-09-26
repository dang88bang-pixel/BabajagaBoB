import type {Status} from "./types";

/**
 * Einheitliches Status-Modell (Abschnitt 5 / 34).
 *
 * Es gibt genau eine Stelle, die einem Zustand Anzeigetext, Farbe, Gruppe und
 * Ergebnis zuordnet: `STATUS_MODEL`. Die Zuordnung ist als
 * `Record<Status, StatusMeta>` typisiert — ein neuer Zustand in `lib/types.ts`
 * ohne Eintrag hier ist ein Compile-Fehler, kein stiller „—“-Platzhalter in der
 * Oberfläche.
 *
 * Die Oberfläche rendert Zustände ausschließlich über `statusLabel`/`statusTone`
 * (Badge-Komponente und Tabellendarstellung). Kein Abschnitt darf Zustände
 * selbst als Text oder Farbe erfinden.
 *
 * `statusModelReport()` liefert die Selbstauskunft des Modells; sie wird über
 * `GET /api/observatory` mit ausgeliefert, damit der Zustand auch zur Laufzeit
 * prüfbar ist (und nicht nur im Quelltext).
 */

/** Gruppe im Lebenszyklus: wartend → aktiv → pausiert → abgeschlossen. */
export type StatusGroup = "PENDING" | "ACTIVE" | "WAITING" | "CLOSED";

/** Ergebnis des Zustands, unabhängig davon, ob er endgültig ist. */
export type StatusOutcome = "OPEN" | "SUCCESS" | "FAILURE" | "ABORTED";

export type StatusMeta = {
  label: string;
  tone: string;
  group: StatusGroup;
  outcome: StatusOutcome;
  /** Endgültig: keine automatische Fortsetzung (Wiederholung/Recovery) mehr erwartet. */
  terminal: boolean;
  description: string;
};

export const STATUS_MODEL: Record<Status, StatusMeta> = {
  QUEUED: {label: "In Warteschlange", tone: "queued", group: "PENDING", outcome: "OPEN", terminal: false, description: "Angenommen, noch nicht begonnen."},
  PLANNING: {label: "In Planung", tone: "planning", group: "PENDING", outcome: "OPEN", terminal: false, description: "Zerlegung in Schritte, noch keine Ausführung."},
  RUNNING: {label: "Läuft", tone: "running", group: "ACTIVE", outcome: "OPEN", terminal: false, description: "Aktive Ausführung innerhalb einer Sandbox."},
  THINKING: {label: "Denkt", tone: "thinking", group: "ACTIVE", outcome: "OPEN", terminal: false, description: "Analyse/Planung eines Agenten ohne Seiteneffekt."},
  EXECUTING: {label: "Führt aus", tone: "executing", group: "ACTIVE", outcome: "OPEN", terminal: false, description: "Autorisierte Ausführung über den Execution Broker."},
  EXPERIMENT: {label: "Experiment", tone: "experiment", group: "ACTIVE", outcome: "OPEN", terminal: false, description: "Messung unter kontrollierten Bedingungen."},
  TESTING: {label: "Prüft", tone: "testing", group: "ACTIVE", outcome: "OPEN", terminal: false, description: "Wiederholung oder Test zur Absicherung."},
  OBSERVING: {label: "Beobachtet", tone: "observing", group: "ACTIVE", outcome: "OPEN", terminal: false, description: "Beobachtung wird erfasst (Baseline, Kontrolle, Messung)."},
  VALIDATING: {label: "Validiert", tone: "validating", group: "ACTIVE", outcome: "OPEN", terminal: false, description: "Evidenz wird gegen eine Behauptung geprüft."},
  WAITING: {label: "Wartet", tone: "waiting", group: "WAITING", outcome: "OPEN", terminal: false, description: "Wartet auf eine Bedingung, Ressource oder Freigabe."},
  BLOCKED: {label: "Blockiert", tone: "blocked", group: "WAITING", outcome: "OPEN", terminal: false, description: "Darf nicht fortgesetzt werden; Grund ist dokumentiert."},
  APPROVAL_REQUIRED: {label: "Freigabe nötig", tone: "approval-required", group: "WAITING", outcome: "OPEN", terminal: false, description: "Wartet auf eine Creator-Freigabe."},
  ERROR: {label: "Fehler", tone: "error", group: "WAITING", outcome: "FAILURE", terminal: false, description: "Fehler erkannt; Diagnose/Recovery entscheidet weiter."},
  BUG: {label: "Defekt", tone: "bug", group: "WAITING", outcome: "FAILURE", terminal: false, description: "Bestätigter Defekt im eigenen Code (nicht Umgebung, nicht Daten)."},
  RECOVERING: {label: "Erholt sich", tone: "recovering", group: "ACTIVE", outcome: "OPEN", terminal: false, description: "Recovery-Stufe wird ausgeführt."},
  ROLLING_BACK: {label: "Rollt zurück", tone: "rolling-back", group: "ACTIVE", outcome: "OPEN", terminal: false, description: "Rücknahme einer Änderung/Ausrollung."},
  SUCCEEDED: {label: "Erfolgreich", tone: "succeeded", group: "CLOSED", outcome: "SUCCESS", terminal: true, description: "Ziel erreicht; Ergebnis ist belegt."},
  FAILED: {label: "Fehlgeschlagen", tone: "failed", group: "CLOSED", outcome: "FAILURE", terminal: true, description: "Ziel nicht erreicht; Fehlschlag ist festgestellt."},
  COMPLETED: {label: "Abgeschlossen", tone: "completed", group: "CLOSED", outcome: "SUCCESS", terminal: true, description: "Vorgang regulär beendet."},
  CANCELLED: {label: "Abgebrochen", tone: "cancelled", group: "CLOSED", outcome: "ABORTED", terminal: true, description: "Bewusst beendet, nicht fehlgeschlagen."}
};

const FALLBACK: StatusMeta = {label: "Unbekannt", tone: "unknown", group: "WAITING", outcome: "OPEN", terminal: false, description: "Zustand ist nicht im Modell — wird als unbekannt angezeigt, nicht als gesund."};

export const STATUS_VALUES = Object.keys(STATUS_MODEL) as Status[];

export const STATUS_GROUPS: StatusGroup[] = ["PENDING", "ACTIVE", "WAITING", "CLOSED"];

/** Ist der Wert ein Zustand des Modells? (Fremddaten werden nie interpretiert.) */
export function isKnownStatus(value: unknown): value is Status {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STATUS_MODEL, value);
}

export function statusMeta(status: string): StatusMeta {
  return isKnownStatus(status) ? STATUS_MODEL[status] : FALLBACK;
}

export const statusLabel = (status: Status): string => statusMeta(status).label;

export const statusTone = (status: Status): string => statusMeta(status).tone;

export const statusGroup = (status: Status): StatusGroup => statusMeta(status).group;

export const statusOutcome = (status: Status): StatusOutcome => statusMeta(status).outcome;

export const isTerminalStatus = (status: Status): boolean => statusMeta(status).terminal;

export type StatusModelReport = {
  total: number;
  groups: Record<StatusGroup, Status[]>;
  outcomes: Record<StatusOutcome, Status[]>;
  terminal: Status[];
  /** Zustände ohne Anzeigetext oder Farbe — muss leer sein. */
  incomplete: Status[];
  /** Zwei Zustände mit gleicher Farbe/Farbe ist erlaubt, gleicher Text nicht. */
  duplicateLabels: string[];
};

/** Selbstauskunft des Modells (Prüfpfad für Laufzeit und Tests). */
export function statusModelReport(): StatusModelReport {
  const groups: Record<StatusGroup, Status[]> = {PENDING: [], ACTIVE: [], WAITING: [], CLOSED: []};
  const outcomes: Record<StatusOutcome, Status[]> = {OPEN: [], SUCCESS: [], FAILURE: [], ABORTED: []};
  const terminal: Status[] = [];
  const incomplete: Status[] = [];
  const labels = new Map<string, Status[]>();
  for (const status of STATUS_VALUES) {
    const meta = STATUS_MODEL[status];
    groups[meta.group].push(status);
    outcomes[meta.outcome].push(status);
    if (meta.terminal) terminal.push(status);
    if (!meta.label.trim() || !meta.tone.trim() || !meta.description.trim()) incomplete.push(status);
    labels.set(meta.label, [...(labels.get(meta.label) ?? []), status]);
  }
  const duplicateLabels = [...labels.entries()].filter(([, statuses]) => statuses.length > 1).map(([label]) => label);
  return {total: STATUS_VALUES.length, groups, outcomes, terminal, incomplete, duplicateLabels};
}
