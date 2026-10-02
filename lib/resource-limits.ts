/** Shared upper bounds for API validation, the broker, and concrete runtimes. */
export const MAX_RESOURCE_LIMITS = {
  cpuMillicores: 8000,
  memoryMb: 16384,
  storageMb: 32768,
  timeoutMs: 3_600_000,
  processes: 512
};
