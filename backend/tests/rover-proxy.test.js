const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoverClient } = require('../rover-proxy');

function response(status, body, contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => (name && name.toLowerCase() === 'content-type' ? contentType : null)
    },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  };
}

test('rover client returns data for successful response', async () => {
  const client = createRoverClient({
    baseUrl: 'http://test.local',
    fetchImpl: async () => response(200, { ok: true, battery: 80 })
  });
  const data = await client.data();
  assert.deepEqual(data, { ok: true, battery: 80 });
});

test('rover client maps non-OK upstream status to 502', async () => {
  const client = createRoverClient({
    baseUrl: 'http://test.local',
    fetchImpl: async () => response(500, { message: 'upstream error' })
  });

  await assert.rejects(
    () => client.data(),
    (error) => error.status === 502 && error.code === 'ROVER_BAD_RESPONSE'
  );
});

test('rover client maps unreachable network to 502', async () => {
  const client = createRoverClient({
    baseUrl: 'http://test.local',
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    }
  });

  await assert.rejects(
    () => client.stop(),
    (error) => error.status === 502 && error.code === 'ROVER_UNREACHABLE'
  );
});

test('rover client maps timeout to 504', async () => {
  const client = createRoverClient({
    baseUrl: 'http://test.local',
    timeoutMs: 50,
    fetchImpl: async (url, options) => {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }
  });

  await assert.rejects(
    () => client.control(1, 1),
    (error) => error.status === 504 && error.code === 'ROVER_TIMEOUT'
  );
});
