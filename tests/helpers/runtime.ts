import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Jede Testdatei erhält ein eigenes, temporäres Storage-Root. Dadurch bleiben
 * Tests isoliert und echte Laufzeitdaten (`.bob-data`) werden nie berührt.
 */
export const TEST_BOOTSTRAP_SECRET = "test-bootstrap-secret-only-for-tests";

export function isolatedStorageRoot(label: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `bob-${label}-`));
  process.env.BOB_STORAGE_DIR = root;
  process.env.BOB_SANDBOX_RUNTIME = "local";
  process.env.BOB_BOOTSTRAP_SECRET = TEST_BOOTSTRAP_SECRET;
  return root;
}
