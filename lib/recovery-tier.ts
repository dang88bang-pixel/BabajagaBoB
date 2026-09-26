import type {RecoveryTier} from "./reliability";

/**
 * Automatische Ableitung der Recovery-Stufe (Abschnitt 15).
 *
 * Bisher wurde die Stufe als Konvention im Plan gesetzt. Diese Klassifikation
 * leitet sie aus dem Fehlerbild ab und **begründet** sie nachvollziehbar. Sie
 * ist bewusst konservativ: im Zweifel wird die *höhere* (eingriffstiefere)
 * Stufe gewählt, und Stufe 4/5 verlangen ausdrücklich Creator-Freigabe – die
 * Klassifikation selbst erteilt keine Berechtigung.
 *
 * | Stufe | Bedeutung | typische Auslöser |
 * |---|---|---|
 * | 1 | Beobachtung/Zustandswechsel ohne Eingriff | Wiederholung, Timeout in einem Versuch, fehlende Telemetrie |
 * | 2 | Wiederherstellung aus Snapshot im Diagnosesandbox | reproduzierbarer Fehllauf mit vorhandenem Checkpoint |
 * | 3 | Eingriff in Sandbox/Umgebung (Reset, Neuaufbau) | Umgebungs-/Ressourcenfehler, beschädigter Workspace, erneuter Fehler nach Restore |
 * | 4 | Eingriff in Code/Artefakt (Fix + erneute Ausführung) | Ursache im Artefakt/Code, nicht in der Umgebung |
 * | 5 | Eingriff in Struktur (Task, Sandbox, Pipeline) | kritische Ursache, Sicherheitsbefund oder Änderung außerhalb der Sandbox |
 */

export type RecoveryClassificationInput = {
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  failureMode?: string;
  symptom?: string;
  incident?: string;
  contributingFactors?: string[];
  rootCause?: string;
  hasCheckpoint?: boolean;
  hasDiagnosticSandbox?: boolean;
  previousRecoveryVerified?: boolean;
  securityRelated?: boolean;
};

export type RecoveryClassification = {
  tier: RecoveryTier;
  reasons: string[];
  requiresCreatorApproval: boolean;
  steps: string[];
};

const ENVIRONMENT_HINTS = [
  "environment",
  "umgebung",
  "ressource",
  "resource",
  "memory",
  "out of memory",
  "disk",
  "timeout",
  "netzwerk",
  "network",
  "workspace",
  "sandbox",
  "infrastruktur"
];

const CODE_HINTS = [
  // Bewusst NICHT das generische Wort "code": "Exit-Code 7" ist kein Codefix.
  "im code",
  "quellcode",
  "codeaenderung",
  "codeänderung",
  "code-fix",
  "codefix",
  "artefakt",
  "artifact",
  "implementierung",
  "logik",
  "regression im code",
  "ausnahmebehandlung",
  "fehlerbehandlung",
  "exception",
  // Wortstamm statt flektierter Form: "nicht behandelt" trifft auch
  // "Nicht behandelter Abbruch".
  "nicht behandelt",
  "unbehandelt",
  "unhandled",
  "abhaengigkeit",
  "dependency"
];

const STRUCTURE_HINTS = ["pipeline", "task", "struktur", "authority", "berechtigung", "governance", "richtlinie"];

function matches(text: string, hints: string[]): string[] {
  const lower = text.toLowerCase();
  return hints.filter(hint => lower.includes(hint));
}

export function classifyRecoveryTier(input: RecoveryClassificationInput): RecoveryClassification {
  const haystack = [input.failureMode, input.symptom, input.incident, input.rootCause, ...(input.contributingFactors ?? [])]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");

  const reasons: string[] = [];
  const environment = matches(haystack, ENVIRONMENT_HINTS);
  const code = matches(haystack, CODE_HINTS);
  const structure = matches(haystack, STRUCTURE_HINTS);

  // 1. Harte Grenzen zuerst: Sicherheit und kritischer Schweregrad eskalieren.
  if (input.securityRelated) reasons.push("Sicherheitsbefund: Eingriff außerhalb der Sandbox erforderlich");
  if (input.severity === "CRITICAL") reasons.push("Schweregrad CRITICAL: Änderung außerhalb der Sandbox möglich");

  // 2. Struktur- und Codehinweise.
  if (structure.length > 0) reasons.push(`Strukturhinweis im Fehlerbild (${structure.slice(0, 3).join(", ")})`);
  if (code.length > 0) reasons.push(`Ursache im Code/Artefakt (${code.slice(0, 3).join(", ")})`);
  if (environment.length > 0) reasons.push(`Umgebungsbezug erkannt (${environment.slice(0, 3).join(", ")})`);

  // 3. Nachweisgrenzen: ohne Diagnosesandbox bzw. ohne Checkpoint ist kein
  //    restore-basierter Weg möglich – dann greift Schema 3 (Umgebung).
  if (input.hasDiagnosticSandbox === false) reasons.push("kein Diagnosesandbox vorhanden: Snapshot-Restore nicht möglich");
  if (input.hasCheckpoint === false) reasons.push("kein Checkpoint vorhanden: Wiederherstellung aus Snapshot nicht belegt");
  if (input.previousRecoveryVerified === false) reasons.push("vorherige Recovery nicht verifiziert: Umgebung gilt als unsicher");

  let tier: RecoveryTier = 2;
  if (input.securityRelated || input.severity === "CRITICAL" || structure.length > 0) tier = 5;
  else if (code.length > 0) tier = 4;
  else if (environment.length > 0 || input.hasDiagnosticSandbox === false || input.hasCheckpoint === false || input.previousRecoveryVerified === false) tier = 3;

  // 4. Fehlen Diagnoseweg **und** Checkpoint und ist die Ursache unbekannt, ist
  //    selbst Stufe 3 unbelegt: dann bleibt es bei Beobachtung (Stufe 1).
  const unknownCause = !input.rootCause || input.rootCause.trim().length === 0;
  if (tier === 3 && unknownCause && input.hasCheckpoint === false && input.hasDiagnosticSandbox === false) {
    tier = 1;
    reasons.push("Ursache unbekannt und kein Eingriffsweg belegt: nur Beobachtung/zustandserhaltende Maßnahme");
  }
  if (tier === 2 && !input.hasCheckpoint) {
    tier = 3;
    reasons.push("kein belegter Checkpoint: eskalierter Eingriff in die Umgebung");
  }

  if (reasons.length === 0) reasons.push("reproduzierbarer Fehllauf mit vorhandenem Checkpoint: Restore im Diagnosesandbox");

  const steps: Record<RecoveryTier, string[]> = {
    1: ["Zustand beobachten", "Ausführung wiederholen", "Versuchszähler prüfen"],
    2: ["betroffene Ausführung isolieren", "Diagnose sammeln", "Snapshot wiederherstellen", "Regression und Smoke ausführen"],
    3: ["Sandbox zurücksetzen", "Workspace neu aufbauen", "Ressourcen-/Umgebungsgrenzen prüfen", "Regression und Smoke ausführen"],
    4: ["Artefakt korrigieren", "Regression im Diagnosesandbox ausführen", "Ergebnis verifizieren"],
    5: ["Struktur ändern (Task/Sandbox/Pipeline)", "Creator-Freigabe einholen", "Regression und Smoke ausführen", "Ergebnis verifizieren"]
  };

  return {
    tier,
    reasons,
    // Stufe 4/5 verändern Code oder Struktur: Freigabe ist Pflicht, die
    // Klassifikation erteilt sie nicht selbst.
    requiresCreatorApproval: tier >= 4,
    steps: steps[tier]
  };
}
