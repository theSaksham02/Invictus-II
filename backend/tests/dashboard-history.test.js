const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

const DASHBOARD_PATH = path.resolve(__dirname, '../../dashboard/mach-x.html');

const browserStubs = `
window.__socketEmits = [];
window.io = function ioStub() {
  const handlers = {};
  window.__socketHandlers = handlers;
  return {
    on(event, callback) {
      handlers[event] = callback;
      if (event === 'connect') setTimeout(callback, 0);
    },
    emit(event, payload) {
      window.__socketEmits.push({ event, payload });
      if (event === 'request_history') {
        setTimeout(() => {
          if (handlers.history) handlers.history(window.__TEST_HISTORY_PAYLOAD);
        }, 0);
      }
    }
  };
};
window.L = {
  map() { return { setView() { return this; }, panTo() {} }; },
  tileLayer() { return { addTo() { return this; } }; },
  polyline() { return { points: [], addTo() { return this; }, addLatLng(point) { this.points.push(point); }, setLatLngs(points) { this.points = points; } }; },
  circleMarker() { return { addTo() { return this; }, setLatLng() {} }; }
};
class UPlotStub {
  constructor(_opts, data, el) { this.data = data; this.el = el; }
  setData(data) { this.data = data; }
  setSize(size) { this.size = size; }
}
window.uPlot = UPlotStub;
class BasicObject {
  constructor() {
    this.position = { set() {}, y: 0, z: 0, x: 0 };
    this.rotation = { x: 0, y: 0, z: 0 };
    this.scale = { setScalar() {} };
  }
  add() {}
  lookAt() {}
}
window.THREE = {
  Scene: class extends BasicObject {},
  FogExp2: class {},
  PerspectiveCamera: class extends BasicObject { updateProjectionMatrix() {} },
  WebGLRenderer: class { setPixelRatio() {} setSize() {} render() {} },
  MeshStandardMaterial: class {},
  Mesh: class extends BasicObject {},
  Group: class extends BasicObject {},
  GridHelper: class extends BasicObject {},
  AmbientLight: class {},
  DirectionalLight: class extends BasicObject {},
  Clock: class { getElapsedTime() { return 1; } },
  CylinderGeometry: class {},
  BoxGeometry: class {},
  TorusGeometry: class {},
  ConeGeometry: class {}
};
`;

const emptyAsset = '';

function packet(source, pktId, altitudeM, timestampMs = pktId * 1000) {
  return {
    source,
    protocol_version: 2,
    pkt_id: pktId,
    timestamp_ms: timestampMs,
    altitude_m: altitudeM,
    temp_c: 21,
    temp_c_1: 20,
    temp_c_2: 20.1,
    temp_c_3: 20.2,
    temp_c_4: 20.3,
    pressure_hpa: 1000,
    accel_z: 1,
    gyro_x: 0.1,
    lat: 25,
    lon: 55,
    rssi_dbm: -80,
    flags: 0x08 | 0x10 | 0x20,
    received_at: 1700000000000 + pktId
  };
}

async function withDashboardServer(fn) {
  const dashboard = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const server = http.createServer((req, res) => {
    if (req.url === '/mach-x') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(dashboard);
      return;
    }
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        signal: {
          mode: 'hardware',
          MACHX: {
            connected: true,
            lost: false,
            live_enabled: true,
            last_seen_ms: Date.now(),
            diagnostics: { last_packet_age_ms: 100, missed_packets: 0, duplicate_packets: 0, out_of_order_packets: 0 }
          }
        }
      }));
      return;
    }
    if (req.url.startsWith('/images/')) {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}/mach-x`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('dashboard renders persisted live-source history through packet-id rollover and ignores wrong-source packets', async (t) => {
  const historyPayload = {
    source: 'MACHX',
    packets: [
      packet('MACHX', 0xfffffffe, 0, 1000),
      packet('MACHX', 0xffffffff, 80, 2000),
      packet('MACHX', 0, 120.5, 3000),
      packet('MACHX', 1, 130.5, 4000)
    ],
    events: [
      { source: 'MACHX', event_type: 'LAUNCHED', altitude_m: 16, timestamp_ms: 2000, received_at: 1700000000100 },
      { source: 'MACHX', event_type: 'ASCENT', altitude_m: 80, timestamp_ms: 4000, received_at: 1700000000200 }
    ]
  };

  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  } catch (error) {
    t.skip(`Puppeteer browser unavailable: ${error.message}`);
    return;
  }

  try {
    await withDashboardServer(async (url) => {
      const page = await browser.newPage();
      const consoleErrors = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      page.on('pageerror', (error) => consoleErrors.push(error.message));

      await page.evaluateOnNewDocument((payload, stubs) => {
        window.__TEST_HISTORY_PAYLOAD = payload;
        Function(stubs)();
      }, historyPayload, browserStubs);

      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const requestUrl = req.url();
        if (
          requestUrl.includes('socket.io') ||
          requestUrl.includes('leaflet') ||
          requestUrl.includes('three') ||
          requestUrl.includes('uPlot')
        ) {
          req.respond({ status: 200, contentType: 'application/javascript', body: emptyAsset });
          return;
        }
        if (requestUrl.includes('fonts.googleapis') || requestUrl.includes('fonts.gstatic') || requestUrl.endsWith('.css')) {
          req.respond({ status: 200, contentType: 'text/css', body: emptyAsset });
          return;
        }
        req.continue();
      });

      await page.goto(url, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => document.getElementById('val-alt')?.textContent.includes('130.5'));

      assert.equal(await page.$eval('#phase-badge', (el) => el.textContent), 'ASCENT');
      assert.equal(await page.$eval('#val-alt', (el) => el.textContent), '+0130.5');
      assert.equal(await page.$eval('#val-apogee', (el) => el.textContent), '+0130.5');
      assert.equal(await page.$eval('#stat-pkts', (el) => el.textContent), '0004');
      assert.match(await page.$eval('#events-list', (el) => el.textContent), /ASCENT/);
      assert.notEqual(await page.$eval('#phase-badge', (el) => el.textContent), 'NO SIGNAL');

      await page.evaluate(() => {
        window.__socketHandlers.packet({ data: { ...window.__TEST_HISTORY_PAYLOAD.packets[3], source: 'CANSAT', altitude_m: 999 } });
      });
      assert.equal(await page.$eval('#val-alt', (el) => el.textContent), '+0130.5');
      assert.deepEqual(consoleErrors, []);
    });
  } finally {
    await browser.close();
  }
});
