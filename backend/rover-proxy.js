const IP = process.env.ROVER_IP || '192.168.4.1';
const PORT = process.env.ROVER_PORT || '5000';
const BASE_URL = `http://${IP}:${PORT}`;
const DEFAULT_TIMEOUT_MS = Math.max(
  Number.parseInt(process.env.ROVER_TIMEOUT_MS || '800', 10) || 800,
  100
);

class RoverProxyError extends Error {
  constructor(message, status, code, details = {}) {
    super(message);
    this.name = 'RoverProxyError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let cachedFetchPromise = null;
function getFetchImpl() {
  if (typeof fetch === 'function') return Promise.resolve(fetch.bind(globalThis));
  if (!cachedFetchPromise) {
    cachedFetchPromise = import('node-fetch').then((m) => m.default);
  }
  return cachedFetchPromise;
}

function createRoverClient(options = {}) {
  const baseUrl = options.baseUrl || BASE_URL;
  const timeoutMs = Math.max(Number.parseInt(options.timeoutMs || DEFAULT_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS, 100);
  const fetchProvider = options.fetchImpl
    ? () => Promise.resolve(options.fetchImpl)
    : getFetchImpl;

  async function proxyRequest(path, method = 'GET', body = null) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchImpl = await fetchProvider();
      const opts = { method, signal: controller.signal };
      if (body) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
      }

      const response = await fetchImpl(`${baseUrl}${path}`, opts);
      const contentType = response.headers.get('content-type') || '';
      const parsed = contentType.includes('application/json')
        ? await response.json().catch(() => ({}))
        : await response.text().catch(() => '');

      if (!response.ok) {
        throw new RoverProxyError(
          'Rover returned non-success status',
          502,
          'ROVER_BAD_RESPONSE',
          { upstream_status: response.status, upstream_body: parsed }
        );
      }

      return parsed;
    } catch (error) {
      if (error instanceof RoverProxyError) throw error;
      if (error && error.name === 'AbortError') {
        throw new RoverProxyError('Rover timeout', 504, 'ROVER_TIMEOUT');
      }
      throw new RoverProxyError('Rover unreachable', 502, 'ROVER_UNREACHABLE');
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    control: (left, right) => proxyRequest('/control', 'POST', { left, right }),
    stop: () => proxyRequest('/stop', 'POST'),
    arm: () => proxyRequest('/arm', 'POST'),
    data: () => proxyRequest('/data', 'GET')
  };
}

const defaultClient = createRoverClient();

module.exports = {
  ...defaultClient,
  createRoverClient,
  RoverProxyError
};
