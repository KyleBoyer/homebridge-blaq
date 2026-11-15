import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebTransport } from '../dist/transport/web.js';
import { NativeTransport } from '../dist/transport/native.js';

const logger = { info() {}, warn() {}, error() {}, debug() {} };

/** A stand-in for a blaQ's web server: one SSE stream plus REST POSTs on the new-format paths. */
const fakeBlaQ = async () => {
  const posts = [];
  const server = createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send('ping', { title: 'GDO blaQ e2e0e4' });
      send('state', { id: 'text_sensor/Device ID', value: 'e2e0e4aabbcc', state: 'e2e0e4aabbcc' });
      send('state', { id: 'cover/Garage Door', state: 'OPEN', value: 1, position: 1, current_operation: 'IDLE' });
      res.write('event: log\ndata: \u001b[0;36m[D][gdo_cover:074]: WARNING for 5000ms\u001b[0m\n\n');
      return;
    }
    posts.push(`${req.method} ${req.url}`);
    res.writeHead(req.url.startsWith('/cover/Garage%20Door') ? 200 : 404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, posts, port: server.address().port };
};

test('web transport: identity, normalized state, clean logs, and commands on discovered paths', async () => {
  const { server, posts, port } = await fakeBlaQ();
  const states = [], logs = [];
  let identity, transport;
  await new Promise(resolve => {
    const check = () => identity && states.length >= 2 && logs.length >= 1 && resolve();
    transport = new WebTransport({
      host: '127.0.0.1', port, logger, logPrefix: '[t]',
      handlers: {
        onState: s => { states.push(s); check(); },
        onLog: l => { logs.push(l); check(); },
        onIdentity: i => { identity = i; check(); },
      },
    });
  });
  assert.deepEqual(identity, { model: 'GDO blaQ e2e0e4', mac: 'E2:E0:E4:AA:BB:CC' });
  assert.deepEqual(states.find(s => s.type === 'cover'), { key: 'cover-garage_door', type: 'cover', position: 1, operation: 'IDLE' });
  assert.equal(logs[0], '[D][gdo_cover:074]: WARNING for 5000ms');
  await transport.command(['cover-garage_door', 'cover-door'], { action: 'close' });
  await transport.command(['cover-garage_door'], { action: 'set_position', position: 0.5 });
  assert.deepEqual(posts, ['POST /cover/Garage%20Door/close', 'POST /cover/Garage%20Door/set?position=0.5']);
  transport.close();
  server.closeAllConnections();
  server.close();
});

test('native transport: open rejects when the Native API port refuses, which is what triggers the auto fallback', async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.close();
  await assert.rejects(NativeTransport.open({
    host: '127.0.0.1', port, logger, logPrefix: '[t]',
    handlers: { onState() {}, onLog() {}, onIdentity() {} },
  }));
});
