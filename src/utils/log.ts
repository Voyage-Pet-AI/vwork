// All logging goes to stderr. stdout is reserved for the report.

export function log(msg: string) {
  process.stderr.write(`[vwork] ${msg}\n`);
}

export function error(msg: string) {
  process.stderr.write(`[vwork] ERROR: ${msg}\n`);
}

export function debug(msg: string) {
  if (process.env.VWORK_DEBUG) {
    process.stderr.write(`[vwork] DEBUG: ${msg}\n`);
  }
}
