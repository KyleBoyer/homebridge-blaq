import EventSource from 'eventsource';
import { Logger } from 'homebridge';

export type LogMessageEvent = MessageEvent<string>;
type OnLogCallback = (logEvent: LogMessageEvent) => void;
export type StateUpdateRecord = Record<string, unknown> & {
    id: string;
};
export type StateUpdateMessageEvent = MessageEvent<string>;
type OnStateUpdateCallback = (stateEvent: StateUpdateMessageEvent) => void;
export type PingMessageEvent = MessageEvent<string>;
type OnPingCallback = (pingEvent: PingMessageEvent) => void;

type AutoReconnectingEventSourceParams = {
    protocol?: 'http' | 'https';
    host: string;
    port?: number;
    path?: string;
    logger: Logger;
    onLog?: OnLogCallback;
    onStateUpdate?: OnStateUpdateCallback;
    onPing?: OnPingCallback;
    maxIdleBeforeReconnect?: number;
};

const ONE_SECOND_IN_MS = 1000;
const ONE_MINUTE_IN_MS = 60 * ONE_SECOND_IN_MS;

export class AutoReconnectingEventSource {
  private protocol: 'http' | 'https';
  private host: string;
  private port: number;
  private path: string;
  private logger: Logger;
  private onLog: OnLogCallback;
  private onStateUpdate: OnStateUpdateCallback;
  private onPing: OnPingCallback;
  private eventSource?: EventSource;
  private lastEventSourceEventDate?: Date;
  private maxIdleBeforeReconnect: number;
  private idleCheckInterval?: NodeJS.Timeout;
  constructor({
    protocol = 'http',
    host,
    port = 80,
    path = 'events',
    maxIdleBeforeReconnect = ONE_MINUTE_IN_MS,
    logger,
    onLog = (log: MessageEvent) =>
      logger.warn('No onLog handler provided to AutoReconnectingEventsource. Got log:', log),
    onStateUpdate = (state: MessageEvent) =>
      logger.warn('No onStateUpdate handler provided to AutoReconnectingEventsource. Got state:', state),
    onPing = (ping?: MessageEvent) =>
      logger.warn('No onPing handler provided to AutoReconnectingEventsource. Got ping:', ping),
  }: AutoReconnectingEventSourceParams){
    this.logger = logger;
    this.logger.debug('Initializing AutoReconnectingEventSource...');
    const correctedProtocol = protocol.split('://').shift();
    this.protocol = correctedProtocol as 'http' | 'https';
    this.host = host;
    this.port = port;
    const correctedPath = path.startsWith('/') ? path.slice(1) : path;
    this.path = correctedPath;
    this.onLog = onLog;
    this.onStateUpdate = onStateUpdate;
    this.onPing = onPing;
    this.maxIdleBeforeReconnect = maxIdleBeforeReconnect;
    this.connectEventSource();
    this.logger.debug('Initialized AutoReconnectingEventSource!');
  }

  private connectEventSource(){
    if(!this.eventSource){
      this.eventSource = new EventSource(`${this.protocol}://${this.host}:${this.port}/${this.path}`);
      this.eventSource.addEventListener('error', error => {
        this.logger.error('EventSource got error', error);
        this.logger.error('Reinitializing EventSource...');
        this.close();
        this.connectEventSource();
      });
      this.eventSource.addEventListener('log', log => {
        this.lastEventSourceEventDate = new Date();
        this.onLog(log);
      });
      this.eventSource.addEventListener('state', state => {
        this.lastEventSourceEventDate = new Date();
        this.onStateUpdate(state);
      });
      this.eventSource.addEventListener('ping', ping => {
        this.lastEventSourceEventDate = new Date();
        this.onPing(ping);
      });
    }
    if(!this.idleCheckInterval){
      this.idleCheckInterval = setInterval(() => this.checkIdleTooLong(), ONE_SECOND_IN_MS);
    }
  }

  private checkIdleTooLong() {
    if(
      this.lastEventSourceEventDate &&
      this.lastEventSourceEventDate.valueOf() < Date.now() - this.maxIdleBeforeReconnect
    ){
      this.close();
      this.connectEventSource();
    }
  }

  public close(){
    if(this.eventSource){
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = undefined;
      this.eventSource.close();
      this.eventSource = undefined;
      this.lastEventSourceEventDate = undefined;
    }
  }

}