import { AutoReconnectingEventSource, LogMessageEvent, PingMessageEvent, StateUpdateMessageEvent } from './utils/eventsource.js';
import { Logger, PlatformAccessory } from 'homebridge';
import { ConfigDevice } from './types.js';
import { BaseBlaQAccessory } from './accessory/base.js';
import { BlaQHomebridgePluginPlatform } from './platform.js';
import { BlaQGarageDoorAccessory } from './accessory/garage-door.js';
import { BlaQGarageLightAccessory } from './accessory/garage-light.js';
import { BlaQGarageLockAccessory } from './accessory/garage-lock.js';

interface BlaQPingEvent {
  title: string;
  comment: string;
  ota: boolean;
  log: boolean;
  lang: string;
}

type ModelAndSerialNumber = {
  model: string;
  serialNumber: string;
};

export type BlaQInitAccessoryCallback = (configDevice: ConfigDevice, Model: string, SerialNumber: string) => {
  platform: BlaQHomebridgePluginPlatform;
  accessory: PlatformAccessory;
};

export class BlaQHub {
  private host: string;
  private port: number;
  private readonly logger: Logger;
  private eventSource?: AutoReconnectingEventSource;
  private initAccessoryCallback: BlaQInitAccessoryCallback;
  private initialized = false;
  private accessories: BaseBlaQAccessory[] = [];

  constructor(private readonly configDevice: ConfigDevice, initAccessoryCallback: BlaQInitAccessoryCallback, logger: Logger) {
    logger.debug('Initializing BlaQHub...');
    this.host = configDevice.host;
    this.port = configDevice.port;
    this.initAccessoryCallback = initAccessoryCallback;
    this.logger = logger;
    this.reinitializeEventSource();
    logger.debug('Initialized BlaQHub!');
  }

  private getAPIBaseURL(){
    return `http://${this.host}:${this.port}`;
  }

  private reinitializeEventSource(){
    if(this.eventSource){
      this.eventSource.close();
    }
    this.eventSource = new AutoReconnectingEventSource({
      host: this.host,
      port: this.port,
      logger: this.logger,
      onStateUpdate: (stateEvent) => this.handleStateUpdate(stateEvent),
      onLog: (logEvent) => this.handleLogUpdate(logEvent),
      onPing: (pingEvent) => this.handlePingUpdate(pingEvent),
    });
  }

  public updateHostPort(host: string, port: number){
    const isChanged = host !== this.host || port !== this.port;
    this.host = host;
    this.port = port;
    if(isChanged){
      this.reinitializeEventSource();
      this.accessories.forEach(accessory => accessory.setAPIBaseURL(this.getAPIBaseURL()));
    }
  }

  private handleStateUpdate(msg: StateUpdateMessageEvent){
    this.accessories.forEach(accessory => {
      if(accessory.handleStateEvent){
        accessory.handleStateEvent(msg);
      }
    });
  }

  private handleLogUpdate(msg: LogMessageEvent){
    this.accessories.forEach(accessory => {
      if(accessory.handleLogEvent){
        accessory.handleLogEvent(msg);
      }
    });
  }

  private initGarageDoorAccessory({ model, serialNumber }: ModelAndSerialNumber){
    const {platform, accessory} = this.initAccessoryCallback(
      this.configDevice,
      model,
      serialNumber,
    );
    this.accessories.push(new BlaQGarageDoorAccessory({
      platform, accessory, model, serialNumber, apiBaseURL: this.getAPIBaseURL(),
    }));
  }

  private initGarageLightAccessory({ model, serialNumber }: ModelAndSerialNumber){
    const accessorySuffix = 'light';
    const nonMainAccessoryMACAddress = this.configDevice.mac && `${this.configDevice.mac}-${accessorySuffix}`;
    const nonMainAccessorySerialNumber = `${serialNumber}-${accessorySuffix}`;
    const {platform, accessory} = this.initAccessoryCallback(
      { ...this.configDevice, mac: nonMainAccessoryMACAddress },
      model,
      nonMainAccessorySerialNumber,
    );
    this.accessories.push(new BlaQGarageLightAccessory({
      platform, accessory, model, serialNumber, apiBaseURL: this.getAPIBaseURL(),
    }));
  }

  private initGarageLockAccessory({ model, serialNumber }: ModelAndSerialNumber){
    const accessorySuffix = 'lock';
    const nonMainAccessoryMACAddress = this.configDevice.mac && `${this.configDevice.mac}-${accessorySuffix}`;
    const nonMainAccessorySerialNumber = `${serialNumber}-${accessorySuffix}`;
    const {platform, accessory} = this.initAccessoryCallback(
      { ...this.configDevice, mac: nonMainAccessoryMACAddress },
      model,
      nonMainAccessorySerialNumber,
    );
    this.accessories.push(new BlaQGarageLockAccessory({
      platform, accessory, model, serialNumber, apiBaseURL: this.getAPIBaseURL(),
    }));
  }

  private initAccessories({ model, serialNumber }: ModelAndSerialNumber){
    this.initGarageDoorAccessory({ model, serialNumber });
    this.initGarageLightAccessory({ model, serialNumber });
    this.initGarageLockAccessory({ model, serialNumber });
  }

  private handlePingUpdate(msg: PingMessageEvent){
    if (!this.initialized && msg.data !== '' ) {
      try {
        const b = JSON.parse(msg.data) as BlaQPingEvent;
        this.logger.info('[init] Publishing accessories with device model:', b.title);
        // title example = GDO blaQ 6084d8
        const titleWithoutGDO = b.title.replace(/^GDO /, '');
        const model = titleWithoutGDO.split(' ').shift() || 'Unknown';
        const serialNumber = titleWithoutGDO.split(' ').pop() || 'Unknown';
        this.initAccessories({
          model,
          serialNumber,
        });
        this.logger.debug('[init] Accessories initialized!');
        this.initialized = true;
      } catch (e) {
        this.logger.debug('[init] Got event:', msg);
        this.logger.debug('[init] Got event data:', msg.data);
        this.logger.error('[init] Cannot parse BlaQPingEvent', e);
      }
    }
    this.accessories.forEach(accessory => {
      if(accessory.handleLogEvent){
        accessory.handleLogEvent(msg);
      }
    });
  }
}
