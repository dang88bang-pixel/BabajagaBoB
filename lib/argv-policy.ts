/**
 * Zentrale argv-Policy (Abschnitt 10 / 18): keine Shell-Strings.
 *
 * Die Plattform führt ausschließlich `argv[]` mit `shell:false` aus. Diese
 * Datei ist die einzige Quelle der Wahrheit für die zugehörigen Prüfungen,
 * damit Broker, Sandbox-Runtimes und Regression Engine identisch fail-closed
 * entscheiden.
 *
 * Verboten sind:
 *  - Shell-Interpreter als Programm (Programmname bzw. Pfad-Basename),
 *  - Shell-Metazeichen in jedem einzelnen Argument,
 *  - leere, nicht-string oder übermäßig lange Argumente.
 */

export const MAX_ARGV_LENGTH = 4096;

const SHELL_INTERPRETERS = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "csh",
  "tcsh",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "wsl",
  "wsl.exe"
]);

const SHELL_METACHARACTERS = /[;&|`$><\n]/;

/** Basename eines Programmpfads, kleingeschrieben (`/bin/Bash` → `bash`). */
export function programBasename(program: string): string {
  const base = program.split(/[\\/]/).pop() ?? program;
  return base.toLowerCase();
}

/** Ist das Programm ein Shell-Interpreter (inkl. Pfadangabe und `.exe`)? */
export function isShellInterpreter(program: string): boolean {
  return SHELL_INTERPRETERS.has(programBasename(program));
}

/** Index des ersten Arguments mit Shell-Metazeichen, sonst `null`. */
export function firstMetacharacterArg(argv: readonly string[]): number | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (typeof arg === "string" && SHELL_METACHARACTERS.test(arg)) return index;
  }
  return null;
}

/** Erster Policy-Verstoß (unabhängig vom Kontext) oder `null`, wenn argv zulässig ist. */
export function argvViolation(argv: readonly string[]): string | null {
  if (!Array.isArray(argv) || argv.length === 0) return "argv must not be empty";
  for (const arg of argv) {
    if (typeof arg !== "string" || arg.length === 0) return "invalid argv entry";
    if (arg.length > MAX_ARGV_LENGTH) return "argv entry too long";
  }
  const index = firstMetacharacterArg(argv);
  if (index !== null) return `shell metacharacters are forbidden in argv[${index}] (argv[] + shell:false)`;
  if (isShellInterpreter(argv[0])) return `shell interpreter '${argv[0]}' is forbidden (argv[] + shell:false)`;
  return null;
}

/** Wirft bei jedem Verstoß; für Runtime- und Registrierungspfade. */
export function assertArgvPolicy(argv: readonly string[], context = "execution"): void {
  const violation = argvViolation(argv);
  if (violation) throw new Error(`${violation}; ${context} uses argv[] with shell:false`);
}
