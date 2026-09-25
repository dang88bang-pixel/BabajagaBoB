/**
 * Vollständige Store-Registrierung.
 *
 * `storeIntegrityReport()`, `backupAllStores()` und `repairStorePayloads()`
 * arbeiten über die im Prozess registrierten Stores. Ein Modul registriert
 * seinen Store erst beim Import — wer nur den Persistenz-Endpunkt importiert,
 * sieht daher nur einen Teil der Stores und würde beschädigte Dateien
 * übersehen (genau das war bei `cicd`, `simulation`, `skills` und `workshop`
 * der Fall).
 *
 * Diese Datei importiert ausschließlich mit dem Ziel, alle Module mit
 * persistentem Store zu laden (Nebenwirkung: Registrierung). Die Importe
 * werden bewusst nicht ausgedünnt.
 */
import "../agent-fabric";
import "../approvals";
import "../artifacts";
import "../audit";
import "../authority";
import "../bootstrap";
import "../cicd";
import "../computer-use";
import "../control-plane";
import "../creator-auth";
import "../devices";
import "../error-intelligence";
import "../events/log";
import "../governance";
import "../inbox";
import "../knowledge";
import "../oci-runtime";
import "../provenance";
import "../provider-fabric";
import "../queue";
import "../regression";
import "../reliability";
import "../runs";
import "../runtime-local";
import "../sandbox/fabric";
import "../science";
import "../session";
import "../simulation";
import "../skills";
import "../verification";
import "../workshop";
import "../workshop-execution";

export const STORE_MODULES_LOADED = true;
