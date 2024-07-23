import { CharacteristicValue, Service } from 'homebridge';
import fetch from 'node-fetch'; // I am, in fact, trying to make fetch happen.

import {
  BlaQButtonEvent,
  GarageLockType,
} from '../types.js';
import { LogMessageEvent, StateUpdateMessageEvent, StateUpdateRecord } from '../utils/eventsource.js';
import { BaseBlaQAccessory, BaseBlaQAccessoryConstructorParams } from './base.js';

const LOCK_PREFIX = 'lock-';

export const label = 'Lock Remotes';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class BlaQGarageLockAccessory extends BaseBlaQAccessory {
  private lockService: Service;
  private isLocked?: boolean;
  private lockType?: GarageLockType = 'lock';

  constructor(args: BaseBlaQAccessoryConstructorParams) {
    super(args);
    this.logger.debug('Initializing BlaQGarageLockAccessory...');
    this.lockService = this.getOrAddService(this.platform.service.LockMechanism);

    // Set the service name.  This is what is displayed as the name on the Home
    // app.  We use what we stored in `accessory.context` in  `discoverDevices`.
    this.lockService.setCharacteristic(this.platform.characteristic.Name, this.accessory.context.device.displayName + ' ' + label);

    this.lockService.getCharacteristic(this.platform.characteristic.LockCurrentState)
      .onGet(this.getLockState.bind(this));

    this.lockService.getCharacteristic(this.platform.characteristic.LockTargetState)
      .onSet(this.changeLockState.bind(this));
    this.logger.debug('Initialized BlaQGarageLockAccessory!');
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

  handleStateEvent(stateEvent: StateUpdateMessageEvent){
    super.handleStateEvent(stateEvent);
    try {
      const stateInfo = JSON.parse(stateEvent.data) as StateUpdateRecord;
      if (['lock-lock', 'lock-lock_remotes'].includes(stateInfo.id)) {
        const buttonEvent = stateInfo as BlaQButtonEvent & { state?: 'ON' | 'OFF' };
        this.lockType = stateInfo.id.split(LOCK_PREFIX).pop() as GarageLockType;
        if(['UNLOCKED', 'LOCKED'].includes(buttonEvent.state?.toUpperCase() || '')){
          this.setLockState(buttonEvent.state?.toUpperCase() === 'LOCKED');
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
