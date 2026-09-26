import crypto from "node:crypto";

/**
 * Kindprozess für die Nebenläufigkeitsprobe (Fehlerinjektion, Abschnitt 37/49).
 *
 * Läuft mit `node --experimental-strip-types` und schreibt **gleichzeitig** mit
 * anderen Instanzen in denselben Store. Damit wird das geprüft, was sich im
 * selben Prozess nicht ehrlich nachstellen lässt: zwei echte Writer.
 *
 * Aufruf:  node --experimental-strip-types tests/helpers/concurrent-writer.ts \
 *            <storageDir> <storeName> <iterations> [mode]
 *
 * `mode`:
 *   update (Standard) — transaktional über `store.update()`; Zähler und Liste
 *                       müssen danach vollständig sein.
 *   write             — unbedingtes Überschreiben, nur als Gegenprobe: hier
 *                       **dürfen** Aktualisierungen verloren gehen.
 *   crash             — schreibt endlos, bis der Test den Prozess abbricht
 *                       (SIGKILL mitten im Schreibvorgang).
 */

const [, , storageDir, storeName, iterationsRaw, modeRaw] = process.argv;
const iterations = Number(iterationsRaw ?? "50");
const mode = modeRaw ?? "update";

if (!storageDir || !storeName) {
  console.error("storageDir und storeName sind Pflicht");
  process.exit(2);
}

process.env.BOB_STORAGE_DIR = storageDir;

const workerId = `W-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;

async function main() {
  // Absichtlich dynamisch: Der Pfad wird zur Laufzeit übergeben, damit dieser
  // Helfer auch außerhalb von tsconfig-Aliasen direkt startbar ist.
  const modulePath = process.env.BOB_STORE_MODULE ?? new URL("../../lib/persistence/store.ts", import.meta.url).pathname;
  const store = (await import(modulePath)) as typeof import("../../lib/persistence/store");
  const counter = store.createStore<{counter: number; writers: string[]}>("fault-counter", 1, () => ({counter: 0, writers: []}));

  if (mode === "crash") {
    // Endlosschleife: Der Test beendet den Prozess hart, absichtlich mitten im
    // Schreibvorgang. Es gibt kein Aufräumen — genau das ist die Probe.
    let n = 0;
    for (;;) {
      n += 1;
      counter.update(draft => {
        draft.counter += 1;
        draft.writers.push(`${workerId}#${n}`);
      });
    }
  }

  if (mode === "write") {
    for (let i = 0; i < iterations; i += 1) {
      const draft = counter.read();
      draft.counter += 1;
      draft.writers.push(`${workerId}#${i}`);
      counter.write(draft);
    }
    process.stdout.write(`${workerId} write ${iterations}\n`);
    return;
  }

  for (let i = 0; i < iterations; i += 1) {
    counter.update(draft => {
      draft.counter += 1;
      draft.writers.push(`${workerId}#${i}`);
    });
  }
  process.stdout.write(`${workerId} update ${iterations}\n`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
