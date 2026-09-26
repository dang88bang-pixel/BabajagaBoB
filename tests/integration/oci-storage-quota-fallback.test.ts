import {mkdtempSync,writeFileSync,chmodSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll,describe,expect,it} from "vitest";
import {ociContainerRuntime} from "../../lib/oci-runtime";

/**
 * Regressionstest für Befund B1 (behoben 2026-09-26):
 * Lehnt der Docker-Daemon `--storage-opt` ab (nur auf manchen
 * Dateisystem-/Daemon-Kombinationen erzwingbar), darf die Runtime weder
 * abstürzen noch die Quota stillschweigend verwerfen — sie muss den
 * Container ohne das Flag anlegen und ausdrücklich `UNAVAILABLE` melden.
 * Umgekehrt gilt: unterstützt der Daemon das Flag, wird `ENFORCED` gemeldet.
 *
 * Statt eines echten Daemons steuert ein PATH-Stub das Verhalten von
 * `docker create` deterministisch (kein Docker-Daemon erforderlich).
 */

const STUB_TEMPLATE = `#!/bin/sh
case "$1" in
  version) echo "27.0.0-stub"; exit 0 ;;
  create)
    for a in "$@"; do
      if [ "$a" = "--storage-opt" ] && [ "__REJECT_QUOTA__" = "yes" ]; then
        echo "Error response from daemon: --storage-opt is not supported on this storage driver" >&2
        exit 1
      fi
    done
    exit 0
    ;;
  rm) exit 0 ;;
  inspect) echo "sha256:stub"; exit 0 ;;
  *) exit 0 ;;
esac
`;

function installDockerStub(rejectQuota: boolean): {restore: () => void; dir: string} {
  const dir = mkdtempSync(join(tmpdir(), "bob-docker-stub-"));
  const bin = join(dir, "docker");
  writeFileSync(bin, STUB_TEMPLATE.replace("__REJECT_QUOTA__", rejectQuota ? "yes" : "no"));
  chmodSync(bin, 0o755);
  const previousPath = process.env.PATH ?? "";
  process.env.PATH = `${dir}:${previousPath}`;
  return {dir, restore: () => { process.env.PATH = previousPath; }};
}

const limits = {cpuMillicores: 500, memoryMb: 256, storageMb: 128, timeoutMs: 60_000, processes: 32};
const cleanup: Array<() => void> = [];

afterAll(() => {
  for (const restore of cleanup.splice(0)) restore();
});

describe("oci storage quota fallback (Befund B1)", () => {
  it("meldet UNAVAILABLE und legt den Container dennoch an, wenn der Daemon --storage-opt ablehnt", async () => {
    const stub = installDockerStub(true);
    cleanup.push(stub.restore);
    const id = `OCI-FB-REJECT-${Date.now()}`;
    try {
      const created = await ociContainerRuntime.create({
        id, type: "integration", network: {mode: "DENY", allowlist: []}, limits, risk: "LOW",
        argv: ["sleep", "infinity"], image: "alpine:3.20"
      });
      expect(created.storageQuota).toBe("UNAVAILABLE");
      expect(created.limits.storageMb).toBe(128); // Limit bleibt deklariert, nichts wird stillschweigend verworfen.
      expect(ociContainerRuntime.handle(id)?.storageQuota).toBe("UNAVAILABLE");
      await ociContainerRuntime.destroy(id);
    } finally {
      await ociContainerRuntime.destroy(id).catch(() => undefined);
      rmSync(stub.dir, {recursive: true, force: true});
    }
  });

  it("meldet ENFORCED, wenn der Daemon --storage-opt akzeptiert", async () => {
    const stub = installDockerStub(false);
    cleanup.push(stub.restore);
    const id = `OCI-FB-ENFORCE-${Date.now()}`;
    try {
      const created = await ociContainerRuntime.create({
        id, type: "integration", network: {mode: "DENY", allowlist: []}, limits, risk: "LOW",
        argv: ["sleep", "infinity"], image: "alpine:3.20"
      });
      expect(created.storageQuota).toBe("ENFORCED");
      expect(ociContainerRuntime.handle(id)?.storageQuota).toBe("ENFORCED");
      await ociContainerRuntime.destroy(id);
    } finally {
      await ociContainerRuntime.destroy(id).catch(() => undefined);
      rmSync(stub.dir, {recursive: true, force: true});
    }
  });
});
