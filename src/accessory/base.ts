import { CharacteristicValue, Logger, PlatformAccessory, Service, WithUUID } from 'homebridge';
import { BlaQHomebridgePluginPlatform } from '../platform';
import { ENTITY_KEYS } from '../utils/entity-ids.js';
import { EntityCommand, EntityState } from '../transport/types.js';

export type SendCommand = (entityKeys: string[], command: EntityCommand) => Promise<void>;

export interface BaseBlaQAccessoryInterface {
    handleStateEvent: (state: EntityState) => void;
    handleLogEvent?: (line: string) => void;
    resetSyncState: () => void;
}

export type BaseBlaQAccessoryConstructorParams = {
    accessory: PlatformAccessory;
    sendCommand: SendCommand;
    friendlyName: string;
    platform: BlaQHomebridgePluginPlatform;
    serialNumber: string;
};

export class BaseBlaQAccessory implements BaseBlaQAccessoryInterface {
  protected firmwareVersion?: string;
  protected synced?: boolean;
  protected queuedEvents: ({ type: 'state'; state: EntityState } | { type: 'log'; line: string })[] = [];
  protected readonly sendCommand: SendCommand;


  protected readonly accessory: PlatformAccessory;
  protected readonly accessoryInformationService: Service;
  protected readonly logger: Logger;
  protected readonly friendlyName: string;
  protected readonly platform: BlaQHomebridgePluginPlatform;
  protected readonly serialNumber: string;

  constructor({
    accessory,
    sendCommand,
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
    this.sendCommand = sendCommand;
    this.accessoryInformationService = this.getOrAddService(this.platform.service.AccessoryInformation);
    // set accessory information
    this.accessoryInformationService
      .setCharacteristic(this.platform.characteristic.Manufacturer, 'Konnected')
      .setCharacteristic(this.platform.characteristic.Model, 'GDO blaQ')
      .setCharacteristic(this.platform.characteristic.SerialNumber, this.serialNumber)
      .setCharacteristic(this.platform.characteristic.Name, this.accessory.context.device.displayName);
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
      if(event.type === 'state'){
        this.handleStateEvent(event.state);
      }else{
        this.handleLogEvent(event.line);
      }
    }
  }

  resetSyncState(){
    this.synced = false;
  }

  handleLogEvent(line: string){
    if(!this.synced){
      this.queuedEvents.push({type: 'log', line});
    }
  }

  handleStateEvent(state: EntityState): void {
    if (state.type === 'onoff' && ENTITY_KEYS.synced.includes(state.key)) {
      this.synced = state.on;
      if(this.synced){
        this.processQueuedEvents();
      }
    } else if (state.type === 'text' && ENTITY_KEYS.firmwareVersion.includes(state.key)) {
      this.setFirmwareVersion(state.value);
    } else if(!this.synced){
      this.queuedEvents.push({type: 'state', state});
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
}
