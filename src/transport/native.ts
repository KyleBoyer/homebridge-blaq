import { Logger } from 'homebridge';
import stripAnsi from 'strip-ansi';
import {
  CoverOperation, EspHomeClient, LockCommand, LockState, LogLevel, TelemetryEvent, entityId, openEspHomeClient,
} from 'esphome-client';
import { CurrentOperationType, LockStateType } from '../types.js';
import { sanitizeObjectID } from '../utils/entity-ids.js';
import { formatMAC } from '../utils/formatters.js';
import { BlaQTransport, EntityCommand, EntityState, TransportHandlers } from './types.js';

export const NATIVE_API_PORT = 6053;

const OPERATIONS: Record<number, CurrentOperationType> = {
  [CoverOperation.IS_OPENING]: 'OPENING',
  [CoverOperation.IS_CLOSING]: 'CLOSING',
};

const LOCK_STATES: Record<number, LockStateType> = {
  [LockState.LOCKED]: 'SECURED',
  [LockState.UNLOCKED]: 'UNSECURED',
  [LockState.JAMMED]: 'JAMMED',
};

/** Turns one Native API state event into an EntityState, or undefined for entities we don't model. */
export const normalizeNativeState = (event: TelemetryEvent): EntityState | undefined => {
  const key = `${event.type}-${sanitizeObjectID(event.entity)}`;
  switch (event.type) {
    case 'cover':
      // Protobuf omits zero values, so a closed, idle door arrives with neither field set.
      return { key, type: 'cover', position: event.position ?? 0, operation: OPERATIONS[event.currentOperation ?? 0] ?? 'IDLE' };
    case 'binary_sensor':
    case 'light':
    case 'switch':
      return { key, type: 'onoff', on: !!event.state };
    case 'lock':
      return { key, type: 'lock', lock: LOCK_STATES[event.state ?? 0] ?? 'UNKNOWN' };
    case 'text_sensor':
      return { key, type: 'text', value: event.state ?? '' };
    default:
      return undefined;
  }
};

type NativeTransportParams = {
  host: string;
  port?: number;
  encryptionKey?: string;
  logger: Logger;
  logPrefix: string;
  handlers: TransportHandlers;
};

/**
 * ESPHome Native API (protobuf over TCP 6053) via esphome-client. A connected client also holds off
 * ESPHome's `api: reboot_timeout`, so no separate heartbeat is needed alongside it.
 */
export class NativeTransport implements BlaQTransport {
  readonly kind = 'native';

  private constructor(private client: EspHomeClient, private readonly params: NativeTransportParams) {
    this.attach();
  }

  /** Resolves once connected, or rejects if the device can't be reached over the Native API. */
  static async open(params: NativeTransportParams): Promise<NativeTransport> {
    return new NativeTransport(await NativeTransport.openClient(params), params);
  }

  private static openClient({ host, port, encryptionKey, logger, logPrefix }: NativeTransportParams) {
    const log = (level: 'debug' | 'warn' | 'error') => (message: string, ...rest: unknown[]) =>
      logger[level](`${logPrefix} [native] ${message}`, ...rest);
    return openEspHomeClient({
      host,
      port: port ?? NATIVE_API_PORT,
      psk: encryptionKey || null,
      clientId: 'homebridge-blaq',
      // The library's info messages are connection chatter; keep them at debug.
      logger: { debug: log('debug'), info: log('debug'), warn: log('warn'), error: log('error') },
      maxConstructionRetries: 0,
    });
  }

  private attach() {
    const { handlers } = this.params;
    const client = this.client;
    client.on('telemetry', event => {
      const state = normalizeNativeState(event);
      if (state) {
        handlers.onState(state);
      }
    });
    client.on('log', ({ message }) => handlers.onLog(stripAnsi(message)));
    client.on('connect', () => handlers.onConnect?.());
    handlers.onConnect?.();
    // esphome-client's LogLevel skips ESPHome's CONFIG (4), so its VERBOSE (5) is ESPHome's DEBUG,
    // the level the door and pre-close warning messages are logged at. The library re-subscribes on reconnect.
    client.subscribeToLogs(LogLevel.VERBOSE);
    const info = client.deviceInfo();
    const mac = formatMAC(info?.macAddress);
    if (info && mac) {
      handlers.onIdentity({ model: info.friendlyName || info.name || 'GDO blaQ', mac });
    }
  }

  // mDNS reports the web server's port; the Native API port is fixed, so only the host matters here.
  setHost(host: string) {
    if (host === this.params.host) {
      return;
    }
    this.params.host = host;
    this.client.disconnect();
    NativeTransport.openClient(this.params).then(client => {
      this.client = client;
      this.attach();
    }, error => this.params.logger.error(`${this.params.logPrefix} Native API reconnect to ${host} failed:`, error));
  }

  close() {
    this.client.disconnect();
  }

  async command(entityKeys: string[], command: EntityCommand) {
    const key = entityKeys.find(candidate => this.client.hasEntity(candidate));
    if (!key) {
      this.params.logger.error(`${this.params.logPrefix} Device has no entity matching: ${entityKeys.join(', ')}`);
      return;
    }
    const objectId = key.slice(key.indexOf('-') + 1);
    const client = this.client;
    switch (command.action) {
      case 'open':
      case 'close':
      case 'stop':
      case 'set_position': {
        const options = command.action === 'stop' ? { stop: true } :
          { position: command.action === 'set_position' ? command.position : command.action === 'open' ? 1 : 0 };
        client.command(entityId('cover', objectId), options);
        return;
      }
      case 'turn_on':
      case 'turn_off': {
        const type = key.startsWith('light-') ? 'light' : 'switch';
        client.command(entityId(type, objectId), { state: command.action === 'turn_on' });
        return;
      }
      case 'lock':
      case 'unlock':
        client.command(entityId('lock', objectId), { command: command.action === 'lock' ? LockCommand.LOCK : LockCommand.UNLOCK });
        return;
      case 'press':
        client.command(entityId('button', objectId), {});
        return;
    }
  }
}
