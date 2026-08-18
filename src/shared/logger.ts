import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const threshold = (): number => {
  const raw = (process.env['LOG_LEVEL'] ?? 'info').toLowerCase();
  return ORDER[raw as LogLevel] ?? ORDER.info;
};

const emit = (level: LogLevel, paint: (s: string) => string, msg: string, data?: unknown): void => {
  if (ORDER[level] < threshold()) return;
  const line = `${paint(`[${level}]`)} ${msg}`;
  if (data === undefined) console.error(line);
  else console.error(line, data);
};

// Logs go to stderr so stdout stays clean for piping of the run summary.
export const logger = {
  debug: (msg: string, data?: unknown) => emit('debug', chalk.gray, msg, data),
  info: (msg: string, data?: unknown) => emit('info', chalk.cyan, msg, data),
  warn: (msg: string, data?: unknown) => emit('warn', chalk.yellow, msg, data),
  error: (msg: string, data?: unknown) => emit('error', chalk.red, msg, data),
};
