import { CharacteristicValue, Service } from 'homebridge';

import {
  BlaQBinarySensorEvent,
  BlaQCoverDoorEvent,
  BlaQLockEvent,
  CurrentOperationType,
  GarageCoverType,
  GarageLockType,
  LockStateType,
  OpenClosedStateType,
} from '../types.js';
import { LogMessageEvent, StateUpdateMessageEvent, StateUpdateRecord } from '../utils/eventsource.js';
import { BaseBlaQAccessory, BaseBlaQAccessoryConstructorParams } from './base.js';

const BINARY_SENSOR_PREFIX = 'binary_sensor-';
const COVER_PREFIX = 'cover-';
const LOCK_PREFIX = 'lock-';

type BlaQGarageDoorAccessoryConstructorParams = BaseBlaQAccessoryConstructorParams & {
  type: 'garage' | 'cover';
};

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class BlaQGarageDoorAccessory extends BaseBlaQAccessory {
  private garageDoorService: Service;
  private state?: OpenClosedStateType;
  private position?: number; // percentage open(100)/closed(0); might not always be accurate
  private targetPosition?: number; // percentage open(100)/closed(0); might not always be accurate
  private currentOperation?: CurrentOperationType;
  private obstructed?: boolean;
  private lockState: LockStateType = 'UNKNOWN';
  private lockType?: GarageLockType = 'lock';
  private coverType?: GarageCoverType = 'garage_door';
  private preClosing?: boolean;

  constructor(args: BlaQGarageDoorAccessoryConstructorParams) {
    super(args);
    this.garageDoorService = this.getOrAddService(
      args.type === 'garage' ? this.platform.service.GarageDoorOpener : this.platform.service.WindowCovering,
    );
    this.removeService(
      args.type !== 'garage' ? this.platform.service.GarageDoorOpener : this.platform.service.WindowCovering,
    );

    // Set the service name.  This is what is displayed as the name on the Home
    // app.  We use what we stored in `accessory.context` in  `discoverDevices`.
    this.garageDoorService.setCharacteristic(this.platform.characteristic.Name, this.accessory.context.device.displayName);

    this.garageDoorService.getCharacteristic(this.platform.characteristic.CurrentDoorState)
      .onGet(this.getCurrentDoorState.bind(this));

    this.garageDoorService.getCharacteristic(this.platform.characteristic.PositionState)
      .onGet(this.getCurrentPositionState.bind(this));

    this.garageDoorService.getCharacteristic(this.platform.characteristic.HoldPosition)
      .onGet(this.getHoldPositionState.bind(this))
      .onSet(this.setHoldPositionState.bind(this));

    this.garageDoorService.getCharacteristic(this.platform.characteristic.CurrentPosition)
      .onGet(this.getCurrentPosition.bind(this));

    this.garageDoorService.getCharacteristic(this.platform.characteristic.TargetDoorState)
      .onGet(this.getTargetDoorState.bind(this))
      .onSet(this.setTargetDoorState.bind(this));

    this.garageDoorService.getCharacteristic(this.platform.characteristic.TargetPosition)
      .onGet(this.getTargetDoorPosition.bind(this))
      .onSet(this.updateTargetDoorPosition.bind(this));

    this.garageDoorService.getCharacteristic(this.platform.characteristic.ObstructionDetected)
      .onGet(this.getObstructed.bind(this));

    this.garageDoorService.getCharacteristic(this.platform.characteristic.LockCurrentState)
      .onGet(this.getLockState.bind(this));

    this.garageDoorService.getCharacteristic(this.platform.characteristic.LockTargetState)
      .onSet(this.updateLockState.bind(this));

    this.logger.debug(`Initialized ${this.getSelfClassName()}!`);
  }

  private async updateLockState(lockState: CharacteristicValue){
    const lockDesired = lockState === this.platform.characteristic.LockTargetState.SECURED;
    const apiTarget: string = lockDesired ? 'lock' : 'unlock';
    const currentlyLocked = this.getLockState() === this.platform.characteristic.LockCurrentState.SECURED;
    if(lockDesired !== currentlyLocked){
      await this.authFetch(`${this.apiBaseURL}/lock/${this.lockType}/${apiTarget}`, {method: 'POST'});
    }
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
    const currentlyLocked = this.getLockState() === this.platform.characteristic.LockCurrentState.SECURED;
    this.garageDoorService.setCharacteristic(
      this.platform.characteristic.LockTargetState,
      currentlyLocked ?
        this.platform.characteristic.LockTargetState.SECURED :
        this.platform.characteristic.LockTargetState.UNSECURED,
    );
    this.garageDoorService.setCharacteristic(
      this.platform.characteristic.LockCurrentState,
      this.getLockState(),
    );
  }

  getCurrentDoorState():
    typeof this.platform.characteristic.CurrentDoorState.CLOSING |
    typeof this.platform.characteristic.CurrentDoorState.OPENING |
    typeof this.platform.characteristic.CurrentDoorState.CLOSED |
    typeof this.platform.characteristic.CurrentDoorState.OPEN |
    typeof this.platform.characteristic.CurrentDoorState.STOPPED {
    if(this.preClosing || this.currentOperation === 'CLOSING' || (
      this.position !== undefined && this.targetPosition !== undefined && this.targetPosition < this.position
    )){
      let closingReason = 'current operation is CLOSING';
      if(this.preClosing){
        closingReason = 'the pre-close warning is active';
      } else if(this.position !== undefined && this.targetPosition !== undefined && this.targetPosition < this.position){
        closingReason = `the target position (${this.targetPosition}) is less than the current position (${this.position})`;
      }
      this.logger.debug(`Returning current state CLOSING because: ${closingReason}`);
      return this.platform.characteristic.CurrentDoorState.CLOSING;
    } else if(this.currentOperation === 'OPENING' || (
      this.position !== undefined && this.targetPosition !== undefined && this.targetPosition > this.position
    )){
      const openingReason =
        this.currentOperation === 'OPENING' ?
          'current operation is OPENING' :
          `the target position (${this.targetPosition}) is greater than the current position (${this.position})`;
      this.logger.debug(`Returning current state OPENING because: ${openingReason}`);
      return this.platform.characteristic.CurrentDoorState.OPENING;
    } else if (this.state === 'OPEN' || (this.position !== undefined && this.position > 0)) {
      const openReason = this.state === 'OPEN' ? 'the current state is OPEN' : 'the current position is greater than zero';
      this.logger.debug(`Returning current state OPEN because: ${openReason}`);
      return this.platform.characteristic.CurrentDoorState.OPEN;
    } else if (this.state === 'CLOSED' || (this.position !== undefined && this.position <= 0)) {
      const closedReason = this.state === 'CLOSED' ? 'the current state is CLOSED' : 'the current position is less than or equal to zero';
      this.logger.debug(`Returning current state CLOSED because: ${closedReason}`);
      return this.platform.characteristic.CurrentDoorState.CLOSED;
    }
    throw new Error(`Invalid door state: ${this.state}`);
  }

  private setCurrentDoorState(state: OpenClosedStateType){
    this.state = state;
    this.updateCurrentDoorState();
  }

  private getHoldPositionState(): CharacteristicValue {
    return [
      this.platform.characteristic.CurrentDoorState.STOPPED,
      this.platform.characteristic.CurrentDoorState.CLOSED,
      this.platform.characteristic.CurrentDoorState.OPEN,
    ].includes(this.getCurrentDoorState());
  }

  private getCurrentPositionState(): CharacteristicValue {
    return {
      [this.platform.characteristic.CurrentDoorState.STOPPED]: this.platform.characteristic.PositionState.STOPPED,
      [this.platform.characteristic.CurrentDoorState.CLOSED]: this.platform.characteristic.PositionState.STOPPED,
      [this.platform.characteristic.CurrentDoorState.OPEN]: this.platform.characteristic.PositionState.STOPPED,
      [this.platform.characteristic.CurrentDoorState.CLOSING]: this.platform.characteristic.PositionState.DECREASING,
      [this.platform.characteristic.CurrentDoorState.OPENING]: this.platform.characteristic.PositionState.INCREASING,
    }[this.getCurrentDoorState()];
  }

  private updateCurrentDoorState(){
    this.garageDoorService.setCharacteristic(
      this.platform.characteristic.CurrentDoorState,
      this.getCurrentDoorState(),
    );
    this.garageDoorService.updateCharacteristic(
      this.platform.characteristic.PositionState,
      this.getCurrentPositionState(),
    );
    this.garageDoorService.updateCharacteristic(
      this.platform.characteristic.HoldPosition,
      this.getHoldPositionState(),
    );
    this.garageDoorService.updateCharacteristic(
      this.platform.characteristic.TargetDoorState,
      this.getTargetDoorState(),
    );
    this.garageDoorService.setCharacteristic(
      this.platform.characteristic.CurrentPosition,
      this.getCurrentPosition(),
    );
    this.garageDoorService.updateCharacteristic(
      this.platform.characteristic.TargetPosition,
      this.getTargetDoorPosition(),
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
      return 100;
    } else if (this.state === 'CLOSED') {
      return 0;
    } else {
      return 50; // unknown state
    }
  }

  private setCurrentPosition(position: number) {
    this.position = position;
    this.updateCurrentDoorState();
  }

  getTargetDoorState(): CharacteristicValue {
    if(this.currentOperation === 'CLOSING' || this.preClosing || (this.targetPosition !== undefined && this.targetPosition <= 0)){
      let closedReason = 'current operation is CLOSING';
      if(this.preClosing){
        closedReason = 'the pre-close warning is active';
      }else if(this.targetPosition !== undefined && this.targetPosition <= 0){
        closedReason = 'target position is less than or equal to zero';
      }
      this.logger.debug(`Returning target state CLOSED because: ${closedReason}`);
      return this.platform.characteristic.TargetDoorState.CLOSED;
    } else if(this.currentOperation === 'OPENING' || (this.targetPosition !== undefined && this.targetPosition > 0)){
      const openReason = this.currentOperation === 'OPENING' ? 'current operation is OPENING' : 'target position is greater than zero';
      this.logger.debug(`Returning target state OPEN because: ${openReason}`);
      return this.platform.characteristic.TargetDoorState.OPEN;
    } else if(this.currentOperation === 'IDLE'){
      if(this.state === 'CLOSED'){
        this.logger.debug('Returning target state CLOSED because: current operation is IDLE and current state is CLOSED');
        return this.platform.characteristic.TargetDoorState.CLOSED;
      }else if(this.state === 'OPEN'){
        this.logger.debug('Returning target state OPEN because: current operation is IDLE and current state is OPEN');
        return this.platform.characteristic.TargetDoorState.OPEN;
      }
    }
    this.logger.debug('Returning target state CLOSED because: no other conditions matched');
    return this.platform.characteristic.TargetDoorState.CLOSED;
    // throw new Error(`Invalid target door state: ${this.currentOperation}`);
  }

  private async setHoldPositionState(target: CharacteristicValue){
    const shouldHold = target;
    if(shouldHold){
      await this.authFetch(`${this.apiBaseURL}/cover/${this.coverType}/stop`, {method: 'POST'});
    }
  }

  private async setTargetDoorState(target: CharacteristicValue){
    let apiTarget: string;
    if (target === this.platform.characteristic.TargetDoorState.CLOSED) {
      apiTarget = 'close';
      this.targetPosition = 0;
    } else if (target === this.platform.characteristic.TargetDoorState.OPEN) {
      this.targetPosition = 100;
      apiTarget = 'open';
    } else {
      throw new Error(`Invalid target door state: ${target}`);
    }
    this.updateCurrentDoorState();
    await this.authFetch(`${this.apiBaseURL}/cover/${this.coverType}/${apiTarget}`, {method: 'POST'});
  }

  getTargetDoorPosition(): CharacteristicValue {
    if(this.targetPosition){
      return this.targetPosition;
    } else if(this.currentOperation === 'OPENING'){
      return 100;
    } else if(this.currentOperation === 'CLOSING' || this.preClosing){
      return 0;
    } else if(this.currentOperation === 'IDLE'){
      if(this.state === 'CLOSED'){
        return 0;
      }else if(this.state === 'OPEN'){
        return 100;
      }
    }
    return 0;
    // throw new Error(`Invalid target door position: ${this.targetPosition}`);
  }

  private async updateTargetDoorPosition(target: CharacteristicValue){
    if(isNaN(+target)){
      throw new Error(`Invalid target door position: ${target}`);
    }
    const roundedTarget = Math.round(+target);
    this.targetPosition = roundedTarget;
    if(this.position){
      this.setCurrentOperation(roundedTarget < this.position ? 'CLOSING' : 'OPENING');
    }
    this.updateCurrentDoorState();
    if(this.position !== roundedTarget){
      await this.authFetch(`${this.apiBaseURL}/cover/${this.coverType}/set?position=${roundedTarget / 100}`, {method: 'POST'});
    }
  }

  private async setTargetDoorPosition(target: number){
    if(isNaN(+target)){
      throw new Error(`Invalid target door position: ${target}`);
    }
    const roundedTarget = Math.round(+target);
    this.targetPosition = roundedTarget;
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

  handleStateEvent(stateEvent: StateUpdateMessageEvent){
    super.handleStateEvent(stateEvent);
    if(!this.synced){
      return;
    }
    try {
      const stateInfo = JSON.parse(stateEvent.data) as StateUpdateRecord;
      if (['cover-garage_door', 'cover-door'].includes(stateInfo.id)) {
        const doorEvent = stateInfo as BlaQCoverDoorEvent;
        this.coverType = stateInfo.id.split(COVER_PREFIX).pop() as GarageCoverType;
        this.setCurrentDoorState(doorEvent.state);
        this.setCurrentOperation(doorEvent.current_operation);
        const curPos = Math.round(doorEvent.position * 100);
        if(doorEvent.current_operation === 'IDLE'){
          this.setTargetDoorPosition(curPos);
        }
        this.setCurrentPosition(curPos);
      } else if (stateInfo.id.startsWith(BINARY_SENSOR_PREFIX)) {
        const binarySensorEvent = stateInfo as BlaQBinarySensorEvent;
        const short_id = binarySensorEvent.id.split(BINARY_SENSOR_PREFIX).pop();
        if (short_id === 'obstruction') {
          this.setObstructed(binarySensorEvent.value);
        }
      } else if (['lock-lock', 'lock-lock_remotes'].includes(stateInfo.id)) {
        this.lockType = stateInfo.id.split(LOCK_PREFIX).pop() as GarageLockType;
        const b = stateInfo as BlaQLockEvent;
        const lockStateMap: Record<string, LockStateType> = {
          'LOCKED': 'SECURED',
          'SECURED': 'SECURED',
          'UNLOCKED': 'UNSECURED',
          'UNSECURED': 'UNSECURED',
        };
        const selectedLockState = lockStateMap[b.state] || 'UNKNOWN';
        this.setLockState(selectedLockState);
      }
    } catch(e) {
      this.logger.error('Cannot deserialize message:', stateEvent);
      this.logger.error('Deserialization yielded:', e);
    }
  }

  handleLogEvent(logEvent: LogMessageEvent){
    super.handleLogEvent(logEvent);
    if(!this.synced){
      return;
    }
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
        const multiplier = positionMatch.includes('%') || positionNum > 1 ? 1 : 100;
        this.setCurrentPosition(positionNum * multiplier);
      }
      if(lowercaseLogStr.includes('moving') && lowercaseLogStr.includes('to position')){
        const movePos = lowercaseLogStr.split('to position').pop()?.trim().split(/[^0-9.]/g).shift();
        if(movePos){
          const multiplier = lowercaseLogStr.includes('%') || +movePos > 1 ? 1 : 100;
          this.setTargetDoorPosition(+movePos * multiplier);
        }
      }
      if (lowercaseLogStr.includes('warning for ')){
        const warningDuration = parseInt(lowercaseLogStr.split('warning for ')?.pop()?.split('ms')?.shift()?.trim() || '5000');
        this.setPreClosing(true);
        setTimeout(() => {
          this.setPreClosing(false);
        }, warningDuration + 100); // add 100ms for closing state to happen right after
      }
    } catch(e) {
      this.logger.error('Log parsing error:', e);
    }
  }

}
