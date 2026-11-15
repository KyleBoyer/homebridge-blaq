import { createConnection, Socket } from 'net';
import { Logger } from 'homebridge';

// ESPHome's `api: reboot_timeout` (default 15min) reboots the device when no client is connected.
// Up to ESPHome 2026.7 any TCP connect reset that timer; from 2026.10 only a client that completed
// the Hello handshake does, so `login: true` keeps a real, logged-in session open instead.
const NATIVE_API_PORT = 6053;
const LEGACY_INTERVAL_MS = 5 * 60 * 1000;
const RECONNECT_DELAY_MS = 30 * 1000;

const MSG = {
  helloRequest: 1,
  helloResponse: 2,
  connectRequest: 3,
  disconnectRequest: 5,
  disconnectResponse: 6,
  pingRequest: 7,
  pingResponse: 8,
} as const;

const encodeVarint = (value: number): number[] => {
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return bytes;
};

/** Plaintext frame: 0x00 preamble, varint payload length, varint message type, payload. */
export const encodeFrame = (type: number, payload: Buffer = Buffer.alloc(0)): Buffer =>
  Buffer.concat([Buffer.from([0x00, ...encodeVarint(payload.length), ...encodeVarint(type)]), payload]);

const decodeVarint = (buf: Buffer, offset: number): [value: number, next: number] | undefined => {
  let value = 0;
  for (let shift = 0, i = offset; i < buf.length && shift < 35; shift += 7, i++) {
    value += (buf[i] & 0x7f) * 2 ** shift;
    if (!(buf[i] & 0x80)) {
      return [value, i + 1];
    }
  }
  return undefined;
};

export type DecodedFrames = { types: number[]; rest: Buffer; encrypted: boolean };

/** Pulls complete frames off the front of `buf`; incomplete bytes are returned in `rest`. */
export const decodeFrames = (buf: Buffer): DecodedFrames => {
  const types: number[] = [];
  let offset = 0;
  while (offset < buf.length) {
    if (buf[offset] !== 0x00) {
      // 0x01 is the Noise (encrypted) preamble: the device wants an encryption key we don't have.
      return { types, rest: Buffer.alloc(0), encrypted: true };
    }
    const len = decodeVarint(buf, offset + 1);
    const type = len && decodeVarint(buf, len[1]);
    if (!len || !type || type[1] + len[0] > buf.length) {
      break;
    }
    types.push(type[0]);
    offset = type[1] + len[0];
  }
  return { types, rest: buf.subarray(offset), encrypted: false };
};

const helloPayload = (clientInfo: string): Buffer => {
  const info = Buffer.from(clientInfo);
  // HelloRequest { client_info = 1; api_version_major = 2; api_version_minor = 3 }
  return Buffer.concat([Buffer.from([0x0a, ...encodeVarint(info.length)]), info, Buffer.from([0x10, 1, 0x18, 14])]);
};

type NativeAPIHeartbeatParams = {
  getHost: () => string;
  login: boolean;
  logger: Logger;
  logPrefix: string;
  clientInfo?: string;
  port?: number;
};

export class NativeAPIHeartbeat {
  private socket?: Socket;
  private timer?: NodeJS.Timeout;
  private wasReachable = true;
  private stopped = false;

  constructor(private readonly params: NativeAPIHeartbeatParams) {
    if (params.login) {
      this.connectSession();
    } else {
      this.timer = setInterval(() => this.poke(), LEGACY_INTERVAL_MS);
    }
  }

  /** Drop the current session and reconnect, e.g. after the device's IP changes. */
  public restart() {
    this.socket?.destroy();
  }

  public stop() {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.timer);
    this.socket?.destroy();
  }

  private onError(error: Error) {
    const { logger, logPrefix } = this.params;
    const message = `${logPrefix} Native API heartbeat could not reach port ${this.params.port ?? NATIVE_API_PORT}: ${error.message}. ` +
      'If the Native API is disabled in your GDO blaQ firmware, turn off the Native API heartbeat setting.';
    // Warn once per outage; repeat failures go to debug so a disabled API doesn't flood the log.
    if (this.wasReachable) {
      logger.warn(message);
    } else {
      logger.debug(message);
    }
    this.wasReachable = false;
  }

  private poke() {
    const socket = createConnection({ host: this.params.getHost(), port: this.params.port ?? NATIVE_API_PORT }, () => {
      this.wasReachable = true;
      setTimeout(() => socket.destroy(), 5 * 1000);
    });
    socket.on('error', error => this.onError(error));
  }

  private connectSession() {
    const { logger, logPrefix } = this.params;
    let pending = Buffer.alloc(0);
    const socket = createConnection({ host: this.params.getHost(), port: this.params.port ?? NATIVE_API_PORT }, () => {
      socket.write(encodeFrame(MSG.helloRequest, helloPayload(this.params.clientInfo ?? 'homebridge-blaq')));
    });
    this.socket = socket;
    socket.setKeepAlive(true, 60 * 1000);
    socket.on('data', chunk => {
      const { types, rest, encrypted } = decodeFrames(Buffer.concat([pending, chunk]));
      pending = rest;
      if (encrypted) {
        logger.warn(`${logPrefix} Native API requires an encryption key, which this plugin does not support; ` +
          'the heartbeat cannot log in. Turn off "Log in to the Native API" to use the basic heartbeat instead.');
        this.stop();
        return;
      }
      for (const type of types) {
        if (type === MSG.helloResponse) {
          // Older ESPHome needs ConnectRequest (empty password) to authenticate; newer ESPHome
          // authenticates on Hello and ignores this message.
          socket.write(encodeFrame(MSG.connectRequest));
          if (!this.wasReachable) {
            logger.info(`${logPrefix} Native API heartbeat connected.`);
          }
          this.wasReachable = true;
          logger.debug(`${logPrefix} Native API heartbeat logged in.`);
        } else if (type === MSG.pingRequest) {
          socket.write(encodeFrame(MSG.pingResponse));
        } else if (type === MSG.disconnectRequest) {
          socket.write(encodeFrame(MSG.disconnectResponse));
          socket.end();
        }
      }
    });
    socket.on('error', error => this.onError(error));
    socket.on('close', () => {
      logger.debug(`${logPrefix} Native API heartbeat session closed.`);
      if (!this.stopped) {
        this.timer = setTimeout(() => this.connectSession(), RECONNECT_DELAY_MS);
      }
    });
  }
}
