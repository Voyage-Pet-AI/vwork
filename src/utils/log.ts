// All logging goes to stderr. stdout is reserved for the report.

export function log(msg: string) {
  process.stderr.write(`[reporter] ${msg}\n`);
}

export function error(msg: string) {
  process.stderr.write(`[reporter] ERROR: ${msg}\n`);
}

export function debug(msg: string) {
  if (process.env.REPORTER_DEBUG) {
    process.stderr.write(`[reporter] DEBUG: ${msg}\n`);
  }
}
