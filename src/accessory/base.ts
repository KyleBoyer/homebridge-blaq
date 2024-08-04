import { CharacteristicValue, Logger, PlatformAccessory, Service, WithUUID } from 'homebridge';
import { LogMessageEvent, PingMessageEvent, StateUpdateMessageEvent, StateUpdateRecord } from '../utils/eventsource';
import { BlaQHomebridgePluginPlatform } from '../platform';
import { BlaQTextSensorEvent } from '../types';

export interface BaseBlaQAccessoryInterface {
    setAPIBaseURL: (apiBaseURL: string) => void;
    handleStateEvent: (stateEvent: StateUpdateMessageEvent) => void;
    handleLogEvent?: (logEvent: LogMessageEvent) => void;
    handlePingEvent?: (pingEvent: PingMessageEvent) => void;
    resetSyncState: () => void;
}

export type BaseBlaQAccessoryConstructorParams = {
    accessory: PlatformAccessory;
    apiBaseURL: string;
    friendlyName: string;
    platform: BlaQHomebridgePluginPlatform;
    serialNumber: string;
};

export const correctAPIBaseURL = (inputURL: string) => {
  let correctedAPIBaseURL = inputURL;
  if(!correctedAPIBaseURL.includes('://')){
    correctedAPIBaseURL = `http://${correctedAPIBaseURL}`;
  }
  if(correctedAPIBaseURL.endsWith('/')){
    correctedAPIBaseURL = correctedAPIBaseURL.slice(0, -1);
  }
  return correctedAPIBaseURL;
};

export class BaseBlaQAccessory implements BaseBlaQAccessoryInterface {
  protected apiBaseURL: string;
  protected firmwareVersion?: string;
  protected synced?: boolean;
  protected queuedEvents: {
    type: 'state' | 'log' | 'ping';
    event: StateUpdateMessageEvent | LogMessageEvent | PingMessageEvent;
  }[] = [];

  protected readonly accessory: PlatformAccessory;
  protected readonly accessoryInformationService: Service;
  protected readonly logger: Logger;
  protected readonly friendlyName: string;
  protected readonly platform: BlaQHomebridgePluginPlatform;
  protected readonly serialNumber: string;

  constructor({
    accessory,
    apiBaseURL,
    friendlyName,
    platform,
    serialNumber,
  }: BaseBlaQAccessoryConstructorParams){
    this.platform = platform;
    this.logger = this.platform.logger;
    this.logger.debug(`Initializing ${this.getSelfClassName()}...`);
    this.accessory = accessory;
    this.friendlyName = friendlyName;
    this.serialNumber = serialNumber;
    this.apiBaseURL = correctAPIBaseURL(apiBaseURL);
    this.accessoryInformationService = this.getOrAddService(this.platform.service.AccessoryInformation);
    // set accessory information
    this.accessoryInformationService
      .setCharacteristic(this.platform.characteristic.Manufacturer, 'Konnected')
      .setCharacteristic(this.platform.characteristic.Model, 'GDO blaQ')
      .setCharacteristic(this.platform.characteristic.SerialNumber, this.serialNumber)
      .setCharacteristic(this.platform.characteristic.Name, this.friendlyName);
    // Publish firmware version; this may not be initialized yet, so we set a getter.
    // Note that this is against the AccessoryInformation service, not the GDO service.
    this.accessoryInformationService
      .getCharacteristic(this.platform.characteristic.FirmwareRevision)
      .onGet(this.getFirmwareVersion.bind(this));
  }

  protected getSelfClassName() {
    return this.constructor.name;
  }

  protected getOrAddService(service: WithUUID<typeof Service> | Service): Service {
    return this.accessory.getService(service as WithUUID<typeof Service>) ||
        this.accessory.addService(service as Service);
  }

  protected removeService(service: WithUUID<typeof Service> | Service): void{
    const foundService = this.accessory.getService(service as WithUUID<typeof Service>);
    if(foundService){
      this.accessory.removeService(foundService);
    }
  }

  processQueuedEvents() {
    while(this.queuedEvents.length){
      const event = this.queuedEvents.shift()!;
      const funcToCall = {
        'ping': (this as BaseBlaQAccessoryInterface).handlePingEvent?.bind(this),
        'log': (this as BaseBlaQAccessoryInterface).handleLogEvent?.bind(this),
        'state': (this as BaseBlaQAccessoryInterface).handleStateEvent?.bind(this),
      }[event.type];
      if(funcToCall){
        funcToCall(event.event);
      }
    }
  }

  resetSyncState(){
    this.synced = false;
  }

  handlePingEvent(pingEvent: PingMessageEvent){
    if(!this.synced){
      this.queuedEvents.push({type: 'ping', event: pingEvent});
    }
  }

  handleLogEvent(logEvent: LogMessageEvent){
    if(!this.synced){
      this.queuedEvents.push({type: 'log', event: logEvent});
    }
  }

  handleStateEvent(stateEvent: StateUpdateMessageEvent): void {
    try {
      const stateInfo = JSON.parse(stateEvent.data) as StateUpdateRecord;
      if (['binary_sensor-synced'].includes(stateInfo.id)) {
        this.synced = stateInfo.value as boolean | undefined;
        if(this.synced){
          this.processQueuedEvents();
        }
      }else if (['text_sensor-esphome_version', 'text_sensor-firmware_version'].includes(stateInfo.id)) {
        const b = stateInfo as BlaQTextSensorEvent;
        if (b.value && b.value === b.state) {
          this.setFirmwareVersion(b.value);
        } else {
          this.logger.error('Mismatched firmware versions in value/state:', b.value, b.state);
          this.firmwareVersion = undefined;
        }
      } else if(!this.synced){
        this.queuedEvents.push({type: 'state', event: stateEvent});
      }
    } catch(e) {
      this.logger.error('Cannot deserialize message:', stateEvent);
      this.logger.error('Deserialization yielded:', e);
    }
  }

  getFirmwareVersion(): CharacteristicValue {
    return this.firmwareVersion || '';
  }

  protected setFirmwareVersion(version: string) {
    this.firmwareVersion = version;
    this.accessoryInformationService.setCharacteristic(
      this.platform.characteristic.FirmwareRevision,
      version,
    );
  }

  setAPIBaseURL(url: string){
    this.apiBaseURL = correctAPIBaseURL(url);
  }
}