import fs from "node:fs";
import path from "node:path";
import {createStore} from "./persistence/store";
import {backupAllStores, listStoreBackups, storageRoot, type BackupFileReport} from "./persistence/store";
import {observe} from "./observability";
import {recordAudit} from "./audit";

/**
 * ============================================================================
 * Backup-Automation mit Aufbewahrungsregel
 * ============================================================================
 *
 * Backups waren vorhanden, aber ausschließlich manuell auslösbar. Dieses Modul
 * ergänzt einen **geplanten** Lauf (idempotent über ein Intervall) und eine
 * **Aufbewahrungsregel**, die alte Sicherungen entfernt — mit harten
 * Sicherheitsgrenzen:
 *
 *  - Es wird **nie** das neueste Backup eines Stores gelöscht.
 *  - Es wird **nie** das einzige Backup eines Stores gelöscht.
 *  - Nicht verifizierbare (korrupte) Sicherungen werden **nicht** aufgeräumt:
 *    sie sind ein Befund, kein Müll — sie werden gemeldet und im Bericht
 *    gezählt.
 *  - Jeder Lauf und jeder Aufräumschritt erzeugt ein Ereignis und einen
 *    Audit-Eintrag (nachvollziehbar, wer was veranlasst hat).
 *
 * Zustand (letzter Lauf, letzter Aufräumlauf) liegt im digest-geprüften Store
 * `backup-automation` und übersteht damit einen Neustart.
 */

export type BackupPolicy = {
  /** Mindestabstand zwischen zwei automatischen Läufen. */
  intervalMs: number;
  /** Wie viele **verifizierte** Backups je Store aufbewahrt werden (mindestens 1). */
  keepPerStore: number;
};

type Payload = {
  lastRunAt: string | null;
  lastPruneAt: string | null;
  runs: number;
  pruned: string[];
  prunedTotal: number;
};

const store = createStore<Payload>("backup-automation", 1, () => ({lastRunAt: null, lastPruneAt: null, runs: 0, pruned: [], prunedTotal: 0}));

const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
};

export function backupPolicy(): BackupPolicy {
  return {
    intervalMs: positiveInt(process.env.BOB_BACKUP_INTERVAL_MS, 60 * 60_000),
    keepPerStore: positiveInt(process.env.BOB_BACKUP_KEEP, 5)
  };
}

export type PruneResult = {
  deleted: Array<{store: string; file: string}>;
  kept: number;
  corrupted: Array<{store: string; file: string; error?: string}>;
  skipped: Array<{store: string; reason: string}>;
};

/**
 * Wendet die Aufbewahrungsregel an. Sortiert je Store nach Dateizeit (neueste
 * zuerst) und löscht nur verifizierte Sicherungen **jenseits** der Grenze.
 */
export function pruneBackups(policy: BackupPolicy = backupPolicy(), reports: BackupFileReport[] = listStoreBackups()): PruneResult {
  const byStore = new Map<string, BackupFileReport[]>();
  for (const report of reports) {
    const list = byStore.get(report.store) ?? [];
    list.push(report);
    byStore.set(report.store, list);
  }
  const deleted: PruneResult["deleted"] = [];
  const corrupted: PruneResult["corrupted"] = [];
  const skipped: PruneResult["skipped"] = [];
  let kept = 0;

  for (const [name, list] of byStore) {
    const ordered = [...list].sort((a, b) => (a.writtenAt ?? "").localeCompare(b.writtenAt ?? "") || a.name.localeCompare(b.name)).reverse();
    const healthy = ordered.filter(report => report.ok);
    const broken = ordered.filter(report => !report.ok);
    for (const report of broken) corrupted.push({store: name, file: report.file, error: report.error});
    // Grenzen: mindestens ein Backup behalten, das neueste nie löschen.
    const keep = Math.max(1, policy.keepPerStore);
    if (healthy.length <= keep) {
      kept += healthy.length;
      if (healthy.length > 0 && healthy.length <= 1) skipped.push({store: name, reason: "nur eine verifizierte Sicherung — sie wird nie aufgeräumt"});
      continue;
    }
    const keepList = healthy.slice(0, keep);
    kept += keepList.length;
    for (const report of healthy.slice(keep)) {
      try {
        fs.rmSync(report.file, {force: false});
        deleted.push({store: name, file: report.file});
      } catch (error) {
        skipped.push({store: name, reason: `Löschen fehlgeschlagen: ${error instanceof Error ? error.message : "unbekannt"}`});
      }
    }
  }
  return {deleted, kept, corrupted, skipped};
}

export type BackupRun = {
  ran: boolean;
  reason: string;
  createdAt: string[];
  verified: number;
  prune: PruneResult | null;
  nextDueAt: string;
  policy: BackupPolicy;
};

/**
 * Führt den geplanten Lauf aus, wenn das Intervall abgelaufen ist.
 * `force` überspringt die Zeitprüfung (Creator-Akt), `prune === false` schaltet
 * das Aufräumen für diesen Lauf ab.
 */
export function runScheduledBackup(input: {force?: boolean; prune?: boolean; actor?: string; now?: Date} = {}): BackupRun {
  const policy = backupPolicy();
  const now = input.now ?? new Date();
  const state = store.read();
  const last = state.lastRunAt ? new Date(state.lastRunAt).getTime() : null;
  const due = last === null || now.getTime() - last >= policy.intervalMs;
  const actor = input.actor ?? "CREATOR";

  if (!due && !input.force) {
    const nextDueAt = new Date((last as number) + policy.intervalMs).toISOString();
    return {ran: false, reason: `Intervall noch nicht abgelaufen (nächster Lauf ${nextDueAt})`, createdAt: [], verified: 0, prune: null, nextDueAt, policy};
  }

  const files = backupAllStores();
  const reports = listStoreBackups().filter(report => files.includes(report.file));
  const verified = reports.filter(report => report.ok).length;
  const prune = input.prune === false ? null : pruneBackups(policy);

  store.update(draft => {
    draft.lastRunAt = now.toISOString();
    draft.runs += 1;
    if (prune) {
      draft.lastPruneAt = now.toISOString();
      draft.pruned = prune.deleted.map(entry => entry.file).slice(-50);
      draft.prunedTotal += prune.deleted.length;
    }
  });

  observe({
    type: "persistence.backup.scheduled",
    message: `Geplantes Backup: ${files.length} Kopien (${verified} verifiziert)${prune ? `, ${prune.deleted.length} aufgeräumt` : ""}`,
    status: "COMPLETED",
    actor,
    action: "persistence.backup.run",
    argumentsValue: {files: files.length, verified, pruned: prune?.deleted.length ?? 0, corrupted: prune?.corrupted.length ?? 0}
  });
  recordAudit(
    {actor, action: "persistence.backup.run", resource: String(files.length), decision: "ALLOW"},
    {files, verified, pruned: prune?.deleted.map(entry => entry.file) ?? []}
  );

  return {
    ran: true,
    reason: input.force && !due ? "erzwungener Lauf (Intervall noch offen)" : "Intervall abgelaufen",
    createdAt: files,
    verified,
    prune,
    nextDueAt: new Date(now.getTime() + policy.intervalMs).toISOString(),
    policy
  };
}

export function backupAutomationStatus(now = new Date()) {
  const state = store.read();
  const policy = backupPolicy();
  const reports = listStoreBackups();
  const last = state.lastRunAt ? new Date(state.lastRunAt).getTime() : null;
  return {
    policy,
    lastRunAt: state.lastRunAt,
    lastPruneAt: state.lastPruneAt,
    runs: state.runs,
    prunedTotal: state.prunedTotal,
    due: last === null || now.getTime() - last >= policy.intervalMs,
    nextDueAt: last === null ? now.toISOString() : new Date(last + policy.intervalMs).toISOString(),
    backups: {
      count: reports.length,
      verified: reports.filter(report => report.ok).length,
      corrupted: reports.filter(report => !report.ok).map(report => ({store: report.store, file: report.file, error: report.error})),
      location: path.join(storageRoot(), "backups")
    },
    integrity: store.integrity()
  };
}
