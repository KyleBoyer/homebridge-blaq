import { CharacteristicValue, Logger, PlatformAccessory, Service } from 'homebridge';
import fetch from 'node-fetch'; // I am, in fact, trying to make fetch happen.

import { BlaQHomebridgePluginPlatform } from '../platform.js';
import {
  BlaQButtonEvent,
  BlaQTextSensorEvent,
  GarageLightType,
} from '../types.js';
import { LogMessageEvent, StateUpdateMessageEvent, StateUpdateRecord } from '../utils/eventsource.js';
import { BaseBlaQAccessory } from './base.js';

const LIGHT_PREFIX = 'light-';

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

type BlaQGarageLightAccessoryConstructorParams = {
    platform: BlaQHomebridgePluginPlatform;
    accessory: PlatformAccessory;
    model: string;
    serialNumber: string;
    apiBaseURL: string;
};

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class BlaQGarageLightAccessory implements BaseBlaQAccessory {
  private logger: Logger;
  private accessoryInformationService: Service;
  private lightbulbService: Service;
  private apiBaseURL: string;
  private firmwareVersion?: string;
  private isOn?: boolean;
  private lightType?: GarageLightType = 'garage_light';
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
  }: BlaQGarageLightAccessoryConstructorParams) {
    this.platform = platform;
    this.logger = this.platform.logger;
    this.logger.debug('Initializing BlaQGarageLightAccessory...');
    this.accessory = accessory;
    this.model = model;
    this.serialNumber = serialNumber;
    this.apiBaseURL = correctAPIBaseURL(apiBaseURL);
    this.lightbulbService = this.accessory.getService(this.platform.service.Lightbulb)
                  || this.accessory.addService(this.platform.service.Lightbulb);

    this.accessoryInformationService = this.accessory.getService(this.platform.service.AccessoryInformation)
                  || this.accessory.addService(this.platform.service.AccessoryInformation);

    // set accessory information
    this.accessoryInformationService
      .setCharacteristic(this.platform.characteristic.Manufacturer, 'Konnected')
      .setCharacteristic(this.platform.characteristic.Model, this.model)
      .setCharacteristic(this.platform.characteristic.SerialNumber, this.serialNumber);

    // Set the service name.  This is what is displayed as the name on the Home
    // app.  We use what we stored in `accessory.context` in  `discoverDevices`.
    this.lightbulbService.setCharacteristic(this.platform.characteristic.Name, accessory.context.device.displayName);

    this.lightbulbService.getCharacteristic(this.platform.characteristic.On)
      .onGet(this.getPowerState.bind(this))
      .onSet(this.changePowerState.bind(this));

    // Publish firmware version; this may not be initialized yet, so we set a getter.
    // Note that this is against the AccessoryInformation service, not the GDO service.
    this.accessoryInformationService
      .getCharacteristic(this.platform.characteristic.FirmwareRevision)
      .onGet(this.getFirmwareVersion.bind(this));
    this.logger.debug('Initialized BlaQGarageLightAccessory!');
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

  getPowerState(): CharacteristicValue {
    return this.isOn || false;
  }

  setPowerState(isOn: boolean) {
    this.isOn = isOn;
    this.lightbulbService.setCharacteristic(
      this.platform.characteristic.On,
      this.isOn,
    );
  }

  private async changePowerState(target: CharacteristicValue){
    const apiTarget: string = target ? 'turn_on' : 'turn_off';
    if(target !== this.isOn){
      await fetch(`${this.apiBaseURL}/light/${this.lightType}/${apiTarget}`, {method: 'POST'});
    }
  }

  setAPIBaseURL(url: string){
    this.apiBaseURL = correctAPIBaseURL(url);
  }

  handleStateEvent(stateEvent: StateUpdateMessageEvent){
    this.logger.debug('Processing state event:', stateEvent.data);
    try {
      const stateInfo = JSON.parse(stateEvent.data) as StateUpdateRecord;
      if (['light-garage_light', 'light-light'].includes(stateInfo.id)) {
        const buttonEvent = stateInfo as BlaQButtonEvent & { state?: 'ON' | 'OFF' };
        this.lightType = stateInfo.id.split(LIGHT_PREFIX).pop() as GarageLightType;
        if(['OFF', 'ON'].includes(buttonEvent.state?.toUpperCase() || '')){
          this.setPowerState(buttonEvent.state?.toUpperCase() === 'ON');
        }
      } else if (['text_sensor-esphome_version', 'text_sensor-firmware_version'].includes(stateInfo.id)) {
        const b = stateInfo as BlaQTextSensorEvent;
        if (b.value === b.state && b.value !== '' && b.value !== null && b.value !== undefined) {
          this.logger.info('Firmware version:', b.value);
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
    this.logger.debug('BlaQ log:', logEvent.data);
    try {
      const logStr = logEvent.data;
      const lowercaseLogStr = logStr.toLowerCase();
      if (lowercaseLogStr.includes('light') && lowercaseLogStr.includes('state') && lowercaseLogStr.includes('on')) {
        this.setPowerState(true);
      } else if (lowercaseLogStr.includes('light') && lowercaseLogStr.includes('state') && lowercaseLogStr.includes('off')) {
        this.setPowerState(false);
      }
    } catch(e) {
      this.logger.error('Log parsing error:', e);
    }
  }
}
