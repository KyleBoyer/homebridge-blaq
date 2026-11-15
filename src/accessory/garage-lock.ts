import { CharacteristicValue, Service } from 'homebridge';

import { ENTITY_KEYS } from '../utils/entity-ids.js';
import { EntityState } from '../transport/types.js';
import { BaseBlaQAccessory, BaseBlaQAccessoryConstructorParams } from './base.js';

export const label = 'Lock Remotes';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class BlaQGarageLockAccessory extends BaseBlaQAccessory {
  private lockService: Service;
  private isLocked?: boolean;

  constructor(args: BaseBlaQAccessoryConstructorParams) {
    super(args);
    this.lockService = this.getOrAddService(this.platform.service.LockMechanism);

    // Set the service name.  This is what is displayed as the name on the Home
    // app.  We use what we stored in `accessory.context` in  `discoverDevices`.
    this.lockService.setCharacteristic(this.platform.characteristic.Name, this.accessory.context.device.displayName + ' ' + label);

    this.lockService.getCharacteristic(this.platform.characteristic.LockCurrentState)
      .onGet(this.getLockState.bind(this));

    this.lockService.getCharacteristic(this.platform.characteristic.LockTargetState)
      .onSet(this.changeLockState.bind(this));
    this.logger.debug(`Initialized ${this.getSelfClassName()}!`);
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
    const action = lockDesired ? 'lock' : 'unlock';
    if(lockDesired !== this.isLocked){
      await this.sendCommand(ENTITY_KEYS.lock, { action });
    }
  }

  handleStateEvent(state: EntityState){
    super.handleStateEvent(state);
    if(this.synced && state.type === 'lock' && ENTITY_KEYS.lock.includes(state.key)
      && (state.lock === 'SECURED' || state.lock === 'UNSECURED')){
      this.setLockState(state.lock === 'SECURED');
    }
  }

  handleLogEvent(line: string){
    super.handleLogEvent(line);
    if(!this.synced){
      return;
    }
    try {
      const logStr = line;
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
