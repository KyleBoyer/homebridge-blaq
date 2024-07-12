import { CharacteristicValue, Logger, PlatformAccessory, Service } from 'homebridge';
import fetch from 'node-fetch'; // I am, in fact, trying to make fetch happen.

import { BlaQHomebridgePluginPlatform } from '../platform.js';
import {
  BlaQBinarySensorEvent,
  BlaQButtonEvent,
  BlaQCoverDoorEvent,
  BlaQLockEvent,
  BlaQTextSensorEvent,
  CurrentOperationType,
  GarageCoverType,
  LockStateType,
  OpenClosedStateType,
} from '../types.js';
import { LogMessageEvent, StateUpdateMessageEvent, StateUpdateRecord } from '../utils/eventsource.js';
import { BaseBlaQAccessory } from './base.js';

const BINARY_SENSOR_PREFIX = 'binary_sensor-';
const BUTTON_PREFIX = 'button-';
const COVER_PREFIX = 'cover-';

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

type BlaQGarageDoorAccessoryConstructorParams = {
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
export class BlaQGarageDoorAccessory implements BaseBlaQAccessory {
  private logger: Logger;
  private accessoryInformationService: Service;
  private garageDoorService: Service;
  private state?: OpenClosedStateType;
  private position?: number; // fraction open/closed; might not always be accurate
  private currentOperation?: CurrentOperationType;
  private obstructed?: boolean;
  private firmwareVersion?: string;
  private lockState: LockStateType = 'UNKNOWN';
  private coverType?: GarageCoverType = 'garage_door';
  private preClosing?: boolean;
  private apiBaseURL: string;
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
  }: BlaQGarageDoorAccessoryConstructorParams) {
    this.platform = platform;
    this.logger = this.platform.logger;
    this.logger.debug('Initializing BlaQGarageDoorAccessory...');
    this.accessory = accessory;
    this.model = model;
    this.serialNumber = serialNumber;
    this.apiBaseURL = correctAPIBaseURL(apiBaseURL);
    this.garageDoorService = this.accessory.getService(this.platform.service.GarageDoorOpener)
                  || this.accessory.addService(this.platform.service.GarageDoorOpener);

    this.accessoryInformationService = this.accessory.getService(this.platform.service.AccessoryInformation)
                  || this.accessory.addService(this.platform.service.AccessoryInformation);

    // set accessory information
    this.accessoryInformationService
      .setCharacteristic(this.platform.characteristic.Manufacturer, 'Konnected')
      .setCharacteristic(this.platform.characteristic.Model, this.model)
      .setCharacteristic(this.platform.characteristic.SerialNumber, this.serialNumber);

    // Set the service name.  This is what is displayed as the name on the Home
    // app.  We use what we stored in `accessory.context` in  `discoverDevices`.
    this.garageDoorService.setCharacteristic(this.platform.characteristic.Name, accessory.context.device.displayName);

    this.garageDoorService.getCharacteristic(this.platform.characteristic.CurrentDoorState)
      .onGet(this.getCurrentDoorState.bind(this));

    this.garageDoorService.getCharacteristic(this.platform.characteristic.CurrentPosition)
      .onGet(this.getCurrentPosition.bind(this));

    this.garageDoorService.getCharacteristic(this.platform.characteristic.TargetDoorState)
      .onGet(this.getTargetDoorState.bind(this))
      .onSet(this.setTargetDoorState.bind(this));

    this.garageDoorService.getCharacteristic(this.platform.characteristic.TargetPosition)
      .onGet(this.getTargetDoorPosition.bind(this))
      .onSet(this.setTargetDoorPosition.bind(this));

    this.garageDoorService.getCharacteristic(this.platform.characteristic.ObstructionDetected)
      .onGet(this.getObstructed.bind(this));

    this.garageDoorService.getCharacteristic(this.platform.characteristic.LockCurrentState)
      .onGet(this.getLockState.bind(this));

    // Publish firmware version; this may not be initialized yet, so we set a getter.
    // Note that this is against the AccessoryInformation service, not the GDO service.
    this.accessoryInformationService
      .getCharacteristic(this.platform.characteristic.FirmwareRevision)
      .onGet(this.getFirmwareVersion.bind(this));
    this.logger.debug('Initialized BlaQGarageDoorAccessory!');
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
    const lockStateMap = {
      'UNSECURED': this.platform.characteristic.LockCurrentState.UNSECURED,
      'SECURED': this.platform.characteristic.LockCurrentState.SECURED,
      'JAMMED': this.platform.characteristic.LockCurrentState.JAMMED,
      'UNKNOWN': this.platform.characteristic.LockCurrentState.UNKNOWN,
    };
    return lockStateMap[this.lockState];
  }

  private setLockState(lockState: LockStateType) {
    this.lockState = lockState;
    this.garageDoorService.setCharacteristic(
      this.platform.characteristic.LockCurrentState,
      this.getLockState(),
    );
  }

  getCurrentDoorState(): CharacteristicValue {
    if(this.preClosing || this.currentOperation === 'CLOSING'){
      return this.platform.characteristic.CurrentDoorState.CLOSING;
    } else if(this.currentOperation === 'OPENING'){
      return this.platform.characteristic.CurrentDoorState.OPENING;
    } else if (this.state === 'OPEN') {
      return this.platform.characteristic.CurrentDoorState.OPEN;
    } else if (this.state === 'CLOSED') {
      return this.platform.characteristic.CurrentDoorState.CLOSED;
    }
    throw new Error('Invalid door state!');
  }

  private setCurrentDoorState(state: OpenClosedStateType){
    this.state = state;
    this.updateCurrentDoorState();
  }

  private updateCurrentDoorState(){
    this.garageDoorService.setCharacteristic(
      this.platform.characteristic.CurrentDoorState,
      this.getCurrentDoorState(),
    );
  }

  private setPreClosing(preClosing: boolean){
    this.preClosing = preClosing;
    this.updateCurrentDoorState();
  }

  private setCurrentOperation(operation: CurrentOperationType){
    this.currentOperation = operation;
    this.updateCurrentDoorState();
  }

  getCurrentPosition(): CharacteristicValue {
    if(this.position){
      return this.position;
    } else if (this.state === 'OPEN') {
      return 1;
    } else if (this.state === 'CLOSED') {
      return 0;
    } else {
      return 0.5; // unknown state
    }
  }

  private setCurrentPosition(position: number) {
    this.position = position;
    this.garageDoorService.setCharacteristic(
      this.platform.characteristic.CurrentPosition,
      this.getCurrentPosition(),
    );
  }

  getTargetDoorState(): CharacteristicValue {
    if(this.currentOperation === 'OPENING'){
      return this.platform.characteristic.TargetDoorState.OPEN;
    } else if(this.currentOperation === 'CLOSING' || this.preClosing){
      return this.platform.characteristic.TargetDoorState.CLOSED;
    } else if(this.currentOperation === 'IDLE'){
      if(this.state === 'CLOSED'){
        return this.platform.characteristic.TargetDoorState.CLOSED;
      }else if(this.state === 'OPEN'){
        return this.platform.characteristic.TargetDoorState.OPEN;
      }
    }
    throw new Error('Invalid target door state!');
  }

  private async setTargetDoorState(target: CharacteristicValue){
    let apiTarget: string;
    if (target === this.platform.characteristic.TargetDoorState.CLOSED) {
      apiTarget = 'close';
    } else if (target === this.platform.characteristic.TargetDoorState.OPEN) {
      apiTarget = 'open';
    } else {
      throw new Error('Invalid target door state!');
    }
    await fetch(`${this.apiBaseURL}/cover/${this.coverType}/${apiTarget}`, {method: 'POST'});
  }

  getTargetDoorPosition(): CharacteristicValue {
    if(this.currentOperation === 'OPENING'){
      return 1;
    } else if(this.currentOperation === 'CLOSING' || this.preClosing){
      return 0;
    } else if(this.currentOperation === 'IDLE'){
      if(this.state === 'CLOSED'){
        return 0;
      }else if(this.state === 'OPEN'){
        return 1;
      }
    }
    throw new Error('Invalid target door position!');
  }

  private async setTargetDoorPosition(target: CharacteristicValue){
    if(isNaN(+target)){
      throw new Error('Invalid target door position!');
    }
    await fetch(`${this.apiBaseURL}/cover/${this.coverType}/set?position=${Math.round(+target * 100)}`, {method: 'POST'});
  }

  getObstructed(): CharacteristicValue {
    if(this.obstructed === undefined){
      this.logger.warn('No obstruction status has been received yet!');
    }
    return this.obstructed || false;
  }

  private setObstructed(obstructed: boolean){
    this.obstructed = obstructed;
    this.garageDoorService.setCharacteristic(
      this.platform.characteristic.ObstructionDetected,
      this.getObstructed(),
    );
  }

  setAPIBaseURL(url: string){
    this.apiBaseURL = correctAPIBaseURL(url);
  }

  handleStateEvent(stateEvent: StateUpdateMessageEvent){
    this.logger.debug('Processing state event:', stateEvent.data);
    try {
      const stateInfo = JSON.parse(stateEvent.data) as StateUpdateRecord;
      if (['cover-garage_door', 'cover-door'].includes(stateInfo.id)) {
        const doorEvent = stateInfo as BlaQCoverDoorEvent;
        this.coverType = stateInfo.id.split(COVER_PREFIX).pop() as GarageCoverType;
        this.setCurrentDoorState(doorEvent.state);
        this.setCurrentOperation(doorEvent.current_operation);
        this.setCurrentPosition(doorEvent.position);
      } else if (stateInfo.id.startsWith(BINARY_SENSOR_PREFIX)) {
        const binarySensorEvent = stateInfo as BlaQBinarySensorEvent;
        const short_id = binarySensorEvent.id.split(BINARY_SENSOR_PREFIX).pop();
        if (short_id === 'obstruction') {
          this.setObstructed(binarySensorEvent.value);
        } else if (short_id?.startsWith('dry_contact_')) {
          this.logger.info(
            `Sensor "${binarySensorEvent.name}" [${short_id}] reports ${binarySensorEvent.state} [${binarySensorEvent.value}].`,
          );
        } else {
          this.logger.info(
            `Sensor "${binarySensorEvent.name}" [${short_id}] reports ${binarySensorEvent.state} [${binarySensorEvent.value}].`,
          );
        }
      } else if (stateInfo.id.startsWith(BUTTON_PREFIX)) {
        const buttonEvent = stateInfo as BlaQButtonEvent;
        const short_id = buttonEvent.id.split(BUTTON_PREFIX).pop();
        this.logger.info(`Button "${buttonEvent.name}" [${short_id}] reports that it exists.`);
      } else if (['text_sensor-esphome_version', 'text_sensor-firmware_version'].includes(stateInfo.id)) {
        const b = stateInfo as BlaQTextSensorEvent;
        if (b.value === b.state && b.value !== '' && b.value !== null && b.value !== undefined) {
          this.logger.info('Firmware version:', b.value);
          this.setFirmwareVersion(b.value);
        } else {
          this.logger.error('Mismatched firmware versions in value/state:', b.value, b.state);
          this.firmwareVersion = undefined;
        }
      } else if (['lock-lock', 'lock-lock_remotes'].includes(stateInfo.id)) {
        const b = stateInfo as BlaQLockEvent;
        const lockStateMap: Record<string, LockStateType> = {
          'LOCKED': 'SECURED',
          'SECURED': 'SECURED',
          'UNLOCKED': 'UNSECURED',
          'UNSECURED': 'UNSECURED',
        };
        const selectedLockState = lockStateMap[b.state] || 'UNKNOWN';
        this.setLockState(selectedLockState);
      } else {
        this.logger.info('Discarding uninteresting state event:', stateInfo.id);
        this.logger.debug('Full message:', stateInfo);
        return;
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
      if (lowercaseLogStr.includes('door') && lowercaseLogStr.includes('state') && lowercaseLogStr.includes('opening')) {
        this.setCurrentOperation('OPENING');
      } else if (lowercaseLogStr.includes('door') && lowercaseLogStr.includes('state') && lowercaseLogStr.includes('closing')) {
        this.setCurrentOperation('CLOSING');
      } else if (lowercaseLogStr.includes('door') && lowercaseLogStr.includes('state') && lowercaseLogStr.includes('open')) {
        this.setCurrentDoorState('OPEN');
      } else if (lowercaseLogStr.includes('door') && lowercaseLogStr.includes('state') && lowercaseLogStr.includes('closed')) {
        this.setCurrentDoorState('CLOSED');
      }
      const positionMatch = lowercaseLogStr.match(/position[:=] ?([\d.]+%?)/g)?.shift();
      if(positionMatch){
        const positionNum = +positionMatch.replaceAll(/[^\d.]+/g, '');
        const multiplier = (positionMatch.includes('%') || positionNum > 1) ? 1/100 : 1;
        this.setCurrentPosition(positionNum * multiplier);
      }
      if (lowercaseLogStr.includes('warning for ')){
        const warningDuration = parseInt(lowercaseLogStr.split('warning for ')?.pop()?.split('ms')?.shift()?.trim() || '5000');
        this.setPreClosing(true);
        setTimeout(() => {
          this.setPreClosing(false);
        }, warningDuration);
      }
    } catch(e) {
      this.logger.error('Log parsing error:', e);
    }
  }

}
