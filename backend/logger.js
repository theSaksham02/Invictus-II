const LEVEL_PRIORITY = { debug: 10, info: 20, warn: 30, error: 40 };
const configuredLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const minPriority = LEVEL_PRIORITY[configuredLevel] || LEVEL_PRIORITY.info;

function shouldLog(level) {
  return (LEVEL_PRIORITY[level] || LEVEL_PRIORITY.info) >= minPriority;
}

function log(level, message, meta = {}) {
  if (!shouldLog(level)) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

module.exports = { log };
