import { CurrentOperationType, LockStateType } from '../types.js';

/**
 * One entity's state, normalized so accessories don't care which API delivered it. `key` is the
 * legacy `${domain}-${object_id}` identifier that ENTITY_KEYS matches on.
 */
export type EntityState =
  | { key: string; type: 'cover'; position: number; operation: CurrentOperationType }
  | { key: string; type: 'onoff'; on: boolean }
  | { key: string; type: 'lock'; lock: LockStateType }
  | { key: string; type: 'text'; value: string };

export type EntityCommand =
  | { action: 'open' | 'close' | 'stop' | 'turn_on' | 'turn_off' | 'lock' | 'unlock' | 'press' }
  | { action: 'set_position'; position: number };

/** Model is the device's own friendly name (e.g. "GDO blaQ 6c8930"); mac is formatted by formatMAC. */
export type DeviceIdentity = { model: string; mac: string };

export type TransportHandlers = {
  onState: (state: EntityState) => void;
  onLog: (line: string) => void;
  onIdentity: (identity: DeviceIdentity) => void;
  /** Called when the transport (re)connects, so stale "synced" state can be reset. */
  onConnect?: () => void;
};

export interface BlaQTransport {
  readonly kind: 'native' | 'web';
  /** `entityKeys` lists every accepted spelling of the entity, best first. */
  command(entityKeys: string[], command: EntityCommand): Promise<void>;
  setHost(host: string, port: number): void;
  close(): void;
}
