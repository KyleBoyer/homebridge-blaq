import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWebState } from '../dist/transport/web.js';
import { normalizeNativeState } from '../dist/transport/native.js';

test('web: cover state from either firmware ID format', () => {
  const expected = { key: 'cover-garage_door', type: 'cover', position: 0.42, operation: 'OPENING' };
  const payload = { state: 'OPEN', value: 0.42, position: 0.42, current_operation: 'OPENING' };
  assert.deepEqual(normalizeWebState({ id: 'cover-garage_door', ...payload }), expected);
  assert.deepEqual(normalizeWebState({ id: 'cover/Garage Door', ...payload }), expected);
});

test('web: on/off, lock and text entities', () => {
  assert.deepEqual(normalizeWebState({ id: 'binary-sensor-synced', state: 'ON', value: true }),
    { key: 'binary_sensor-synced', type: 'onoff', on: true });
  assert.deepEqual(normalizeWebState({ id: 'light/Garage Light', state: 'OFF' }),
    { key: 'light-garage_light', type: 'onoff', on: false });
  assert.deepEqual(normalizeWebState({ id: 'lock-lock', state: 'LOCKED', value: 1 }),
    { key: 'lock-lock', type: 'lock', lock: 'SECURED' });
  assert.deepEqual(normalizeWebState({ id: 'text_sensor/Device ID', state: '64e83360884c', value: '64e83360884c' }),
    { key: 'text_sensor-device_id', type: 'text', value: '64e83360884c' });
  assert.equal(normalizeWebState({ id: 'sensor-uptime', state: '12 s', value: 12 }), undefined);
});

test('native: protobuf-omitted fields read as closed, idle, off', () => {
  assert.deepEqual(normalizeNativeState({ type: 'cover', entity: 'Garage Door', key: 1 }),
    { key: 'cover-garage_door', type: 'cover', position: 0, operation: 'IDLE' });
  assert.deepEqual(normalizeNativeState({ type: 'cover', entity: 'Garage Door', key: 1, position: 0.5, currentOperation: 2 }),
    { key: 'cover-garage_door', type: 'cover', position: 0.5, operation: 'CLOSING' });
  assert.deepEqual(normalizeNativeState({ type: 'binary_sensor', entity: 'Motion', key: 2 }),
    { key: 'binary_sensor-motion', type: 'onoff', on: false });
  assert.deepEqual(normalizeNativeState({ type: 'lock', entity: 'Lock', key: 3, state: 2 }),
    { key: 'lock-lock', type: 'lock', lock: 'UNSECURED' });
  assert.deepEqual(normalizeNativeState({ type: 'button', entity: 'Pre-close Warning', key: 4 }), undefined);
});
