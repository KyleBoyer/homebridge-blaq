import { AutoReconnectingEventSource, LogMessageEvent, PingMessageEvent, StateUpdateMessageEvent } from './utils/eventsource.js';
import { Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { BlaQTextSensorEvent, ConfigDevice } from './types.js';
import { BaseBlaQAccessoryInterface } from './accessory/base.js';
import { BlaQHomebridgePluginPlatform } from './platform.js';
import { BlaQGarageDoorAccessory } from './accessory/garage-door.js';
import { BlaQGarageLightAccessory } from './accessory/garage-light.js';
import { BlaQGarageLockAccessory } from './accessory/garage-lock.js';
import { BlaQGarageMotionSensorAccessory } from './accessory/garage-motion-sensor.js';
import { BlaQGaragePreCloseWarningAccessory } from './accessory/garage-pre-close-warning.js';
import { BlaQGarageLearnModeAccessory } from './accessory/garage-learn-mode.js';
import { BlaQGarageObstructionSensorAccessory } from './accessory/garage-obstruction-sensor.js';
import { formatMAC } from './utils/formatters.js';

interface BlaQPingEvent {
  title: string;
  comment: string;
  ota: boolean;
  log: boolean;
  lang: string;
}

type FriendlyNameAndSerialNumber = {
  friendlyName: string;
  serialNumber: string;
};

type InitAccessoryParams = FriendlyNameAndSerialNumber & {
  platform: BlaQHomebridgePluginPlatform;
  accessory: PlatformAccessory;
};

export type BlaQInitAccessoryCallback = (configDevice: ConfigDevice, Model: string, SerialNumber: string) => {
  platform: BlaQHomebridgePluginPlatform;
  accessory: PlatformAccessory;
};

export class BlaQHub {
  private accessories: BaseBlaQAccessoryInterface[] = [];
  private eventSource?: AutoReconnectingEventSource;
  private host: string;
  private initialized = false;
  private friendlyName?: string;
  private deviceMac?: string;
  private port: number;
  private eventsBeforeAccessoryInit: {
    type: 'state' | 'log' | 'ping';
    event: StateUpdateMessageEvent | LogMessageEvent | PingMessageEvent;
  }[] = [];

  private readonly initAccessoryCallback: BlaQInitAccessoryCallback;
  private readonly logger: Logger;

  constructor(
    private readonly pluginConfig: PlatformConfig,
    private readonly configDevice: ConfigDevice,
    initAccessoryCallback: BlaQInitAccessoryCallback,
    logger: Logger,
  ) {
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

  private possiblyFinalizeInit(){
    if(!this.initialized && this.friendlyName && this.deviceMac){
      this.logger.info('[init] Publishing accessories with device model:', this.friendlyName);
      this.initAccessories({
        friendlyName: this.friendlyName,
        serialNumber: this.deviceMac,
      });
      this.initialized = true;
      this.eventsBeforeAccessoryInit.forEach(oldEvent => {
        const getFuncToCall = {
          'ping': (accessory: BaseBlaQAccessoryInterface) => accessory.handlePingEvent?.bind(accessory),
          'log': (accessory: BaseBlaQAccessoryInterface) => accessory.handleLogEvent?.bind(accessory),
          'state': (accessory: BaseBlaQAccessoryInterface) => accessory.handleStateEvent?.bind(accessory),
        }[oldEvent.type];
        this.accessories.forEach(accessory => {
          const funcToCall = getFuncToCall(accessory);
          if(funcToCall){
            funcToCall(oldEvent.event);
          }
        });
      });
      this.eventsBeforeAccessoryInit = [];
      this.logger.debug('[init] Accessories initialized!');
    }
  }

  private handleStateUpdate(msg: StateUpdateMessageEvent){
    if(!this.initialized){
      this.eventsBeforeAccessoryInit.push({ type: 'state', event: msg });
    }
    if (!this.initialized && msg.data !== '' ) {
      try {
        const b = JSON.parse(msg.data) as BlaQTextSensorEvent;
        if(['text_sensor-device_id'].includes(b.id)){
          this.deviceMac = formatMAC(b.value);
        }
        this.possiblyFinalizeInit();
      } catch (e) {
        this.logger.debug('[init] Got event:', msg);
        this.logger.debug('[init] Got event data:', msg.data);
        this.logger.error('[init] Cannot parse BlaQTextSensorEvent', e);
      }
    }
    this.logger.debug('Processing state event:', msg.data);
    this.accessories.forEach(accessory => {
      if(accessory.handleStateEvent){
        accessory.handleStateEvent(msg);
      }
    });
  }

  private handleLogUpdate(msg: LogMessageEvent){
    if(!this.initialized){
      this.eventsBeforeAccessoryInit.push({ type: 'log', event: msg });
    }
    this.logger.debug('BlaQ log:', msg.data);
    this.accessories.forEach(accessory => {
      if(accessory.handleLogEvent){
        accessory.handleLogEvent(msg);
      }
    });
  }

  private initGarageDoorAccessory({ platform, accessory, friendlyName, serialNumber}: InitAccessoryParams){
    this.accessories.push(new BlaQGarageDoorAccessory({
      platform, accessory, friendlyName, serialNumber, apiBaseURL: this.getAPIBaseURL(),
    }));
  }

  private initGarageLightAccessory({ platform, accessory, friendlyName, serialNumber}: InitAccessoryParams){
    if(this.pluginConfig.enableLight ?? true) {
      this.accessories.push(new BlaQGarageLightAccessory({
        platform, accessory, friendlyName, serialNumber, apiBaseURL: this.getAPIBaseURL(),
      }));
    }
  }

  private initGarageLockAccessory({ platform, accessory, friendlyName, serialNumber}: InitAccessoryParams){
    if(this.pluginConfig.enableLockRemotes ?? true){
      this.accessories.push(new BlaQGarageLockAccessory({
        platform, accessory, friendlyName, serialNumber, apiBaseURL: this.getAPIBaseURL(),
      }));
    }
  }

  private initGarageMotionSensorAccessory({ platform, accessory, friendlyName, serialNumber}: InitAccessoryParams){
    if(this.pluginConfig.enableMotionSensor ?? true){
      this.accessories.push(new BlaQGarageMotionSensorAccessory({
        platform, accessory, friendlyName, serialNumber, apiBaseURL: this.getAPIBaseURL(),
      }));
    }
  }

  private initGaragePreCloseWarningAccessory({ platform, accessory, friendlyName, serialNumber}: InitAccessoryParams){
    if(this.pluginConfig.enablePreCloseWarning ?? true){
      this.accessories.push(new BlaQGaragePreCloseWarningAccessory({
        platform, accessory, friendlyName, serialNumber, apiBaseURL: this.getAPIBaseURL(),
      }));
    }
  }

  private initGarageLearnModeAccessory({ platform, accessory, friendlyName, serialNumber}: InitAccessoryParams){
    if(this.pluginConfig.enableLearnMode ?? true){
      this.accessories.push(new BlaQGarageLearnModeAccessory({
        platform, accessory, friendlyName, serialNumber, apiBaseURL: this.getAPIBaseURL(),
      }));
    }
  }

  private initGarageObstructionSensorAccessory({ platform, accessory, friendlyName, serialNumber}: InitAccessoryParams){
    if(this.pluginConfig.enableSeparateObstructionSensor ?? true){
      this.accessories.push(new BlaQGarageObstructionSensorAccessory({
        platform, accessory, friendlyName, serialNumber, apiBaseURL: this.getAPIBaseURL(),
      }));
    }
  }

  private initAccessories({ friendlyName, serialNumber }: FriendlyNameAndSerialNumber){
    const {platform, accessory} = this.initAccessoryCallback(
      this.configDevice,
      friendlyName,
      serialNumber,
    );
    this.initGarageDoorAccessory({ platform, accessory, friendlyName, serialNumber });
    this.initGarageLightAccessory({ platform, accessory, friendlyName, serialNumber });
    this.initGarageLockAccessory({ platform, accessory, friendlyName, serialNumber });
    this.initGarageMotionSensorAccessory({ platform, accessory, friendlyName, serialNumber });
    this.initGaragePreCloseWarningAccessory({ platform, accessory, friendlyName, serialNumber });
    this.initGarageLearnModeAccessory({ platform, accessory, friendlyName, serialNumber });
    this.initGarageObstructionSensorAccessory({ platform, accessory, friendlyName, serialNumber });
  }

  private handlePingUpdate(msg: PingMessageEvent){
    if(!this.initialized){
      this.eventsBeforeAccessoryInit.push({ type: 'ping', event: msg });
    }
    if (!this.initialized && msg.data !== '' ) {
      try {
        const b = JSON.parse(msg.data) as BlaQPingEvent;
        this.friendlyName = b.title;
        this.possiblyFinalizeInit();
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
