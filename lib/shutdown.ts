let draining = false;
let startedAt: string | undefined;

export function beginShutdown(reason = "signal"):void {
  if (draining) return;
  draining = true;
  startedAt = new Date().toISOString();
  process.emitWarning("BabajagaBoB entering graceful shutdown: " + reason);
}

export function isShuttingDown():boolean { return draining || process.env.BOB_SHUTTING_DOWN === "1"; }

export function shutdownStatus() {
  return {draining, startedAt: startedAt ?? null};
}