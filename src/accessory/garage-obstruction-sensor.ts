import { CharacteristicValue, Logger, PlatformAccessory, Service } from 'homebridge';

import { BlaQHomebridgePluginPlatform } from '../platform.js';
import {
  BlaQBinarySensorEvent,
  BlaQTextSensorEvent,
} from '../types.js';
import { LogMessageEvent, StateUpdateMessageEvent, StateUpdateRecord } from '../utils/eventsource.js';
import { BaseBlaQAccessory } from './base.js';

const correctAPIBaseURL = (inputURL: string) => {
  let correctedAPIBaseURL = inputURL;
  if(!correctedAPIBaseURL.includes('://')){
    correctedAPIBaseURL = `http://${correctedAPIBaseURL}`;
  }
  if(correctedAPIBaseURL.endsWith('/')){
    correctedAPIBaseURL = correctedAPIBaseURL.slice(0, -1);
  }
  return correctedAPIBaseURL;
};

type BlaQGarageObstructionSensorAccessoryConstructorParams = {
    platform: BlaQHomebridgePluginPlatform;
    accessory: PlatformAccessory;
    model: string;
    serialNumber: string;
    apiBaseURL: string;
};

export const label = 'Obstruction Sensor';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class BlaQGarageObstructionSensorAccessory implements BaseBlaQAccessory {
  private logger: Logger;
  private accessoryInformationService: Service;
  private occupancySensorService: Service;
  private apiBaseURL: string;
  private firmwareVersion?: string;
  private obstructionDetected?: boolean;
  private readonly platform: BlaQHomebridgePluginPlatform;
  private readonly accessory: PlatformAccessory;
  private readonly model: string;
  private readonly serialNumber: string;

  constructor({
    platform,
    accessory,
    model,
    serialNumber,
    apiBaseURL,
  }: BlaQGarageObstructionSensorAccessoryConstructorParams) {
    this.platform = platform;
    this.logger = this.platform.logger;
    this.logger.debug('Initializing BlaQGarageObstructionSensorAccessory...');
    this.accessory = accessory;
    this.model = model;
    this.serialNumber = serialNumber;
    this.apiBaseURL = correctAPIBaseURL(apiBaseURL);
    this.occupancySensorService = this.accessory.getService(this.platform.service.OccupancySensor)
                  || this.accessory.addService(this.platform.service.OccupancySensor);

    this.accessoryInformationService = this.accessory.getService(this.platform.service.AccessoryInformation)
                  || this.accessory.addService(this.platform.service.AccessoryInformation);

    // set accessory information
    this.accessoryInformationService
      .setCharacteristic(this.platform.characteristic.Manufacturer, 'Konnected')
      .setCharacteristic(this.platform.characteristic.Model, this.model)
      .setCharacteristic(this.platform.characteristic.SerialNumber, this.serialNumber);

    // Set the service name.  This is what is displayed as the name on the Home
    // app.  We use what we stored in `accessory.context` in  `discoverDevices`.
    this.occupancySensorService.setCharacteristic(this.platform.characteristic.Name, accessory.context.device.displayName + ' ' + label);

    this.occupancySensorService.getCharacteristic(this.platform.characteristic.OccupancyDetected)
      .onGet(this.getObstructionDetected.bind(this));

    // Publish firmware version; this may not be initialized yet, so we set a getter.
    // Note that this is against the AccessoryInformation service, not the GDO service.
    this.accessoryInformationService
      .getCharacteristic(this.platform.characteristic.FirmwareRevision)
      .onGet(this.getFirmwareVersion.bind(this));
    this.logger.debug('Initialized BlaQGarageObstructionSensorAccessory!');
  }

  getFirmwareVersion(): CharacteristicValue {
    return this.firmwareVersion || '';
  }

  private setFirmwareVersion(version: string) {
    this.firmwareVersion = version;
    this.accessoryInformationService.setCharacteristic(
      this.platform.characteristic.FirmwareRevision,
      version,
    );
  }

  getObstructionDetected(): CharacteristicValue {
    return this.obstructionDetected || false;
  }

  setObstructionDetected(obstructionDetected: boolean) {
    this.obstructionDetected = obstructionDetected;
    this.occupancySensorService.setCharacteristic(
      this.platform.characteristic.OccupancyDetected,
      this.obstructionDetected,
    );
  }

  setAPIBaseURL(url: string){
    this.apiBaseURL = correctAPIBaseURL(url);
  }

  handleStateEvent(stateEvent: StateUpdateMessageEvent){
    try {
      const stateInfo = JSON.parse(stateEvent.data) as StateUpdateRecord;
      if (['binary_sensor-obstruction'].includes(stateInfo.id)) {
        const sensorEvent = stateInfo as BlaQBinarySensorEvent;
        if(['OFF', 'ON'].includes(sensorEvent.state.toUpperCase())){
          this.setObstructionDetected(sensorEvent.state.toUpperCase() === 'ON');
        }
      } else if (['text_sensor-esphome_version', 'text_sensor-firmware_version'].includes(stateInfo.id)) {
        const b = stateInfo as BlaQTextSensorEvent;
        if (b.value === b.state && b.value !== '' && b.value !== null && b.value !== undefined) {
          this.setFirmwareVersion(b.value);
        } else {
          this.logger.error('Mismatched firmware versions in value/state:', b.value, b.state);
          this.firmwareVersion = undefined;
        }
      }
    } catch(e) {
      this.logger.error('Cannot deserialize message:', stateEvent);
      this.logger.error('Deserialization yielded:', e);
    }
  }

  handleLogEvent(logEvent: LogMessageEvent){
    try {
      const logStr = logEvent.data;
      const lowercaseLogStr = logStr.toLowerCase();
      const obstructionStateOn =
        lowercaseLogStr.includes('obstruction') && lowercaseLogStr.includes('state') && lowercaseLogStr.includes('on');
      const obstructionStateOff =
        lowercaseLogStr.includes('obstruction') && lowercaseLogStr.includes('state') && lowercaseLogStr.includes('off');
      const obstructionObstructed =
        lowercaseLogStr.includes('obstruction') && lowercaseLogStr.includes('obstructed');
      const obstructionClear =
        lowercaseLogStr.includes('obstruction') && lowercaseLogStr.includes('clear');
      if (obstructionStateOn || obstructionObstructed) {
        this.setObstructionDetected(true);
      } else if (obstructionStateOff || obstructionClear) {
        this.setObstructionDetected(false);
      }
    } catch(e) {
      this.logger.error('Log parsing error:', e);
    }
  }
}
