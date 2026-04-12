type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_STYLES: Record<LogLevel, string> = {
  debug: 'color: #6b7280',
  info: 'color: #3b82f6',
  warn: 'color: #f59e0b',
  error: 'color: #ef4444; font-weight: bold',
};

const isDev = import.meta.env.DEV;
const minLevel: LogLevel = isDev ? 'debug' : 'warn';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

function formatTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function log(level: LogLevel, tag: string, message: string, ...data: unknown[]) {
  if (!shouldLog(level)) return;

  const prefix = `%c[${formatTime()}] [${level.toUpperCase()}] [${tag}]`;
  const style = LEVEL_STYLES[level];

  const fn =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : level === 'debug'
          ? console.debug
          : console.info;

  if (data.length > 0) {
    fn(prefix, style, message, ...data);
  } else {
    fn(prefix, style, message);
  }
}

export const logger = {
  debug: (tag: string, message: string, ...data: unknown[]) =>
    log('debug', tag, message, ...data),

  info: (tag: string, message: string, ...data: unknown[]) =>
    log('info', tag, message, ...data),

  warn: (tag: string, message: string, ...data: unknown[]) =>
    log('warn', tag, message, ...data),

  error: (tag: string, message: string, ...data: unknown[]) =>
    log('error', tag, message, ...data),
};
