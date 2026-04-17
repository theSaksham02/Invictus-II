const IP = process.env.ROVER_IP || '192.168.4.1';
const PORT = process.env.ROVER_PORT || '5000';
const BASE_URL = `http://${IP}:${PORT}`;

async function proxyRequest(path, method = 'GET', body = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  
  try {
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    const opts = { method, signal: controller.signal };
    if (body) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    
    const res = await fetch(`${BASE_URL}${path}`, opts);
    clearTimeout(timeout);
    
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch (e) {
    clearTimeout(timeout);
    return { ok: false, error: e.name === 'AbortError' ? 'Rover timeout' : 'Rover unreachable' };
  }
}

module.exports = {
  control: (left, right) => proxyRequest('/control', 'POST', { left, right }),
  stop: () => proxyRequest('/stop', 'POST'),
  data: () => proxyRequest('/data', 'GET')
};