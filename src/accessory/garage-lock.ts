import { CharacteristicValue, Logger, PlatformAccessory, Service } from 'homebridge';
import fetch from 'node-fetch'; // I am, in fact, trying to make fetch happen.

import { BlaQHomebridgePluginPlatform } from '../platform.js';
import {
  BlaQButtonEvent,
  BlaQTextSensorEvent,
  GarageLockType,
} from '../types.js';
import { LogMessageEvent, StateUpdateMessageEvent, StateUpdateRecord } from '../utils/eventsource.js';
import { BaseBlaQAccessory } from './base.js';

const LOCK_PREFIX = 'lock-';

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

type BlaQGarageLockAccessoryConstructorParams = {
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
export class BlaQGarageLockAccessory implements BaseBlaQAccessory {
  private logger: Logger;
  private accessoryInformationService: Service;
  private lockService: Service;
  private apiBaseURL: string;
  private firmwareVersion?: string;
  private isLocked?: boolean;
  private lockType?: GarageLockType = 'lock';
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
  }: BlaQGarageLockAccessoryConstructorParams) {
    this.platform = platform;
    this.logger = this.platform.logger;
    this.logger.debug('Initializing BlaQGarageLockAccessory...');
    this.accessory = accessory;
    this.model = model;
    this.serialNumber = serialNumber;
    this.apiBaseURL = correctAPIBaseURL(apiBaseURL);
    this.lockService = this.accessory.getService(this.platform.service.LockMechanism)
                  || this.accessory.addService(this.platform.service.LockMechanism);

    this.accessoryInformationService = this.accessory.getService(this.platform.service.AccessoryInformation)
                  || this.accessory.addService(this.platform.service.AccessoryInformation);

    // set accessory information
    this.accessoryInformationService
      .setCharacteristic(this.platform.characteristic.Manufacturer, 'Konnected')
      .setCharacteristic(this.platform.characteristic.Model, this.model)
      .setCharacteristic(this.platform.characteristic.SerialNumber, this.serialNumber);

    // Set the service name.  This is what is displayed as the name on the Home
    // app.  We use what we stored in `accessory.context` in  `discoverDevices`.
    this.lockService.setCharacteristic(this.platform.characteristic.Name, accessory.context.device.displayName);

    this.lockService.getCharacteristic(this.platform.characteristic.LockCurrentState)
      .onGet(this.getLockState.bind(this));

    this.lockService.getCharacteristic(this.platform.characteristic.LockTargetState)
      .onSet(this.changeLockState.bind(this));

    // Publish firmware version; this may not be initialized yet, so we set a getter.
    // Note that this is against the AccessoryInformation service, not the GDO service.
    this.accessoryInformationService
      .getCharacteristic(this.platform.characteristic.FirmwareRevision)
      .onGet(this.getFirmwareVersion.bind(this));
    this.logger.debug('Initialized BlaQGarageLockAccessory!');
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

  getLockState(): CharacteristicValue {
    if(this.isLocked === undefined || this.isLocked === null){
      return this.platform.characteristic.LockCurrentState.UNKNOWN;
    }
    return this.isLocked ?
      this.platform.characteristic.LockCurrentState.SECURED :
      this.platform.characteristic.LockCurrentState.UNSECURED;
  }

  setLockState(isLocked: boolean) {
    this.isLocked = isLocked;
    this.lockService.setCharacteristic(
      this.platform.characteristic.LockTargetState,
      this.isLocked ?
        this.platform.characteristic.LockTargetState.SECURED :
        this.platform.characteristic.LockTargetState.UNSECURED,
    );
    this.lockService.setCharacteristic(
      this.platform.characteristic.LockCurrentState,
      this.getLockState(),
    );
  }

  private async changeLockState(target: CharacteristicValue){
    const lockDesired = target === this.platform.characteristic.LockTargetState.SECURED;
    const apiTarget: string = lockDesired ? 'lock' : 'unlock';
    if(lockDesired !== this.isLocked){
      await fetch(`${this.apiBaseURL}/lock/${this.lockType}/${apiTarget}`, {method: 'POST'});
    }
  }

  setAPIBaseURL(url: string){
    this.apiBaseURL = correctAPIBaseURL(url);
  }

  handleStateEvent(stateEvent: StateUpdateMessageEvent){
    try {
      const stateInfo = JSON.parse(stateEvent.data) as StateUpdateRecord;
      if (['lock-lock', 'lock-lock_remotes'].includes(stateInfo.id)) {
        const buttonEvent = stateInfo as BlaQButtonEvent & { state?: 'ON' | 'OFF' };
        this.lockType = stateInfo.id.split(LOCK_PREFIX).pop() as GarageLockType;
        if(['UNLOCKED', 'LOCKED'].includes(buttonEvent.state?.toUpperCase() || '')){
          this.setLockState(buttonEvent.state?.toUpperCase() === 'LOCKED');
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
      if (lowercaseLogStr.includes('lock') && lowercaseLogStr.includes('state') && lowercaseLogStr.includes('unlocked')) {
        this.setLockState(false);
      } else if (lowercaseLogStr.includes('lock') && lowercaseLogStr.includes('state') && lowercaseLogStr.includes('locked')) {
        this.setLockState(true);
      }
    } catch(e) {
      this.logger.error('Log parsing error:', e);
    }
  }
}
