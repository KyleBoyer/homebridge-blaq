import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { NativeAPIHeartbeat, encodeFrame, decodeFrames } from '../dist/utils/native-api-heartbeat.js';

const makeLogger = () => {
  const lines = { info: [], warn: [], error: [], debug: [] };
  return { lines, logger: Object.fromEntries(Object.keys(lines).map(l => [l, (...a) => lines[l].push(a.join(' '))])) };
};

test('frame codec round-trips and keeps partial frames', () => {
  const big = encodeFrame(300, Buffer.alloc(200));
  const both = Buffer.concat([encodeFrame(7), big]);
  assert.deepEqual(decodeFrames(both).types, [7, 300]);
  const partial = decodeFrames(both.subarray(0, both.length - 1));
  assert.deepEqual(partial.types, [7]);
  assert.equal(partial.rest.length, big.length - 1);
  assert.equal(decodeFrames(Buffer.from([0x01, 0x00])).encrypted, true);
});

test('login session sends Hello, then Connect, and answers pings', async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { logger } = makeLogger();
  const hb = new NativeAPIHeartbeat({ getHost: () => '127.0.0.1', port: server.address().port, login: true, logger, logPrefix: '[t]' });
  const [sock] = await once(server, 'connection');
  const received = [];
  let buf = Buffer.alloc(0);
  const gotPong = new Promise(resolve => sock.on('data', chunk => {
    const { types, rest } = decodeFrames(Buffer.concat([buf, chunk]));
    buf = rest;
    for (const type of types) {
      received.push(type);
      if (type === 1) sock.write(Buffer.concat([encodeFrame(2), encodeFrame(7)]));
      if (type === 8) resolve();
    }
  }));
  await gotPong;
  assert.deepEqual(received, [1, 3, 8]);
  hb.stop();
  server.close();
});

test('refused connection warns once instead of crashing', async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.close();
  const { lines, logger } = makeLogger();
  const hb = new NativeAPIHeartbeat({ getHost: () => '127.0.0.1', port, login: true, logger, logPrefix: '[t]' });
  await new Promise(resolve => setTimeout(resolve, 200));
  hb.stop();
  assert.equal(lines.warn.length, 1);
  assert.match(lines.warn[0], /ECONNREFUSED/);
});
