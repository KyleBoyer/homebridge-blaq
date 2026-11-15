import { Logger } from 'homebridge';
import fetch, { Response } from 'node-fetch';
import stripAnsi from 'strip-ansi';
import { LockStateType } from '../types.js';
import { AutoReconnectingEventSource, StateUpdateRecord } from '../utils/eventsource.js';
import { buildEntityPathCandidates, parseStateRecord } from '../utils/entity-ids.js';
import { formatMAC } from '../utils/formatters.js';
import { BlaQTransport, EntityCommand, EntityState, TransportHandlers } from './types.js';

const LOCK_STATES: Record<string, LockStateType> = {
  LOCKED: 'SECURED',
  SECURED: 'SECURED',
  UNLOCKED: 'UNSECURED',
  UNSECURED: 'UNSECURED',
  JAMMED: 'JAMMED',
};

/** Turns one `/events` state payload into an EntityState, or undefined for entities we don't model. */
export const normalizeWebState = (record: StateUpdateRecord): EntityState | undefined => {
  const entity = parseStateRecord(record);
  if (!entity) {
    return undefined;
  }
  const { key, domain } = entity;
  const state = typeof record.state === 'string' ? record.state.toUpperCase() : undefined;
  switch (domain) {
    case 'cover': {
      const position = typeof record.position === 'number' ? record.position : (state === 'OPEN' ? 1 : 0);
      const operation = record.current_operation;
      return {
        key, type: 'cover', position,
        operation: operation === 'OPENING' || operation === 'CLOSING' ? operation : 'IDLE',
      };
    }
    case 'binary_sensor':
    case 'light':
    case 'switch':
      return state === 'ON' || state === 'OFF' ? { key, type: 'onoff', on: state === 'ON' } : undefined;
    case 'lock':
      return state ? { key, type: 'lock', lock: LOCK_STATES[state] ?? 'UNKNOWN' } : undefined;
    case 'text_sensor':
      return typeof record.value === 'string' ? { key, type: 'text', value: record.value } : undefined;
    default:
      return undefined;
  }
};

type WebTransportParams = {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  logger: Logger;
  logPrefix: string;
  handlers: TransportHandlers;
};

/** ESPHome web_server: REST for commands, Server-Sent Events (`/events`) for state and logs. */
export class WebTransport implements BlaQTransport {
  readonly kind = 'web';
  private eventSource?: AutoReconnectingEventSource;
  /** Legacy entity key -> REST path that this device is known to accept. */
  private readonly entityPaths = new Map<string, string>();
  private model?: string;
  private mac?: string;
  private identified = false;

  constructor(private readonly params: WebTransportParams) {
    this.connect();
  }

  private connect() {
    const { host, port, user, pass, logger, handlers } = this.params;
    this.eventSource?.close();
    handlers.onConnect?.();
    this.eventSource = new AutoReconnectingEventSource({
      host, port, user, pass, logger,
      onStateUpdate: msg => this.handleState(msg.data),
      onLog: msg => handlers.onLog(stripAnsi(msg.data)),
      onPing: msg => this.handlePing(msg.data),
    });
  }

  private handleState(data: string) {
    if (!data) {
      return;
    }
    let record: StateUpdateRecord;
    try {
      record = JSON.parse(data) as StateUpdateRecord;
    } catch (e) {
      this.params.logger.error(`${this.params.logPrefix} Cannot parse state event:`, data, e);
      return;
    }
    const entity = parseStateRecord(record);
    if (entity) {
      // The device is the source of truth for its own URLs, so remember what it told us.
      this.entityPaths.set(entity.key, entity.path);
    }
    const state = normalizeWebState(record);
    if (state?.type === 'text' && state.key === 'text_sensor-device_id') {
      this.mac = formatMAC(state.value);
      this.maybeIdentify();
    }
    if (state) {
      this.params.handlers.onState(state);
    }
  }

  private handlePing(data: string) {
    if (!data || this.model) {
      return;
    }
    try {
      this.model = (JSON.parse(data) as { title?: string }).title;
      this.maybeIdentify();
    } catch (e) {
      this.params.logger.error(`${this.params.logPrefix} Cannot parse ping event:`, data, e);
    }
  }

  private maybeIdentify() {
    if (!this.identified && this.model && this.mac) {
      this.identified = true;
      this.params.handlers.onIdentity({ model: this.model, mac: this.mac });
    }
  }

  setHost(host: string, port: number) {
    if (host !== this.params.host || port !== this.params.port) {
      this.params.host = host;
      this.params.port = port;
      this.connect();
    }
  }

  close() {
    this.eventSource?.close();
  }

  async command(entityKeys: string[], command: EntityCommand) {
    const { action, query } = command.action === 'set_position' ?
      { action: 'set', query: `position=${command.position}` } :
      { action: command.action, query: undefined };
    await this.entityFetch(entityKeys, action, query);
  }

  /**
   * POSTs an action to an entity, falling back through the known URL formats on a 404 so that the
   * same code works against firmware from either side of the ESPHome 2026.7 URL change, and
   * regardless of which spelling of the entity's object_id the device settled on.
   */
  private async entityFetch(entityKeys: string[], action: string, query?: string) {
    const { logger, host, port } = this.params;
    const suffix = `/${action}${query ? `?${query}` : ''}`;
    const candidates = buildEntityPathCandidates(entityKeys, this.entityPaths);
    let response: Response | undefined;
    for (const path of candidates) {
      response = await this.authFetch(`http://${host}:${port}${path}${suffix}`);
      if (response.status !== 404) {
        this.entityPaths.set(entityKeys[0], path); // skip straight to this one next time
        return;
      }
      logger.debug(`Got a 404 for ${path}${suffix}; trying the next known URL format...`);
    }
    if (!response) {
      logger.error(`Cannot build a URL for unrecognized entity: ${entityKeys.join(', ')}`);
    } else {
      logger.error(`No known URL format worked for ${entityKeys[0]}; tried: ${candidates.join(', ')}`);
    }
  }

  private authFetch(url: string) {
    const { user, pass } = this.params;
    return fetch(url, {
      method: 'POST',
      headers: user && pass ? { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` } : {},
    });
  }
}
