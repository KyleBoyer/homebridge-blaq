import { CharacteristicValue, Service } from 'homebridge';
import fetch from 'node-fetch'; // I am, in fact, trying to make fetch happen.

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

  constructor(args: BaseBlaQAccessoryConstructorParams) {
    super(args);
    this.logger.debug('Initializing BlaQGarageDoorAccessory...');
    this.garageDoorService = this.getOrAddService(this.platform.service.GarageDoorOpener);

    // Set the service name.  This is what is displayed as the name on the Home
    // app.  We use what we stored in `accessory.context` in  `discoverDevices`.
    this.garageDoorService.setCharacteristic(this.platform.characteristic.Name, this.accessory.context.device.displayName);

    this.garageDoorService.getCharacteristic(this.platform.characteristic.CurrentDoorState)
      .onGet(this.getCurrentDoorState.bind(this));

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

    this.logger.debug('Initialized BlaQGarageDoorAccessory!');
  }

  private async updateLockState(lockState: CharacteristicValue){
    const lockDesired = lockState === this.platform.characteristic.LockTargetState.SECURED;
    const apiTarget: string = lockDesired ? 'lock' : 'unlock';
    const currentlyLocked = this.getLockState() === this.platform.characteristic.LockCurrentState.SECURED;
    if(lockDesired !== currentlyLocked){
      await fetch(`${this.apiBaseURL}/lock/${this.lockType}/${apiTarget}`, {method: 'POST'});
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

  getCurrentDoorState(): CharacteristicValue {
    if(this.preClosing || this.currentOperation === 'CLOSING' || (
      this.position !== undefined && this.targetPosition !== undefined && this.targetPosition < this.position
    )){
      return this.platform.characteristic.CurrentDoorState.CLOSING;
    } else if(this.currentOperation === 'OPENING' || (
      this.position !== undefined && this.targetPosition !== undefined && this.targetPosition > this.position
    )){
      return this.platform.characteristic.CurrentDoorState.OPENING;
    } else if (this.state === 'OPEN' || (this.position !== undefined && this.position > 0)) {
      return this.platform.characteristic.CurrentDoorState.OPEN;
    } else if (this.state === 'CLOSED' || (this.position !== undefined && this.position <= 0)) {
      return this.platform.characteristic.CurrentDoorState.CLOSED;
    }
    throw new Error(`Invalid door state: ${this.state}`);
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
      return this.platform.characteristic.TargetDoorState.CLOSED;
    } else if(this.currentOperation === 'OPENING' || (this.targetPosition !== undefined && this.targetPosition > 0)){
      return this.platform.characteristic.TargetDoorState.OPEN;
    } else if(this.currentOperation === 'IDLE'){
      if(this.state === 'CLOSED'){
        return this.platform.characteristic.TargetDoorState.CLOSED;
      }else if(this.state === 'OPEN'){
        return this.platform.characteristic.TargetDoorState.OPEN;
      }
    }
    return this.platform.characteristic.TargetDoorState.CLOSED;
    // throw new Error(`Invalid target door state: ${this.currentOperation}`);
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
    await fetch(`${this.apiBaseURL}/cover/${this.coverType}/${apiTarget}`, {method: 'POST'});
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
      await fetch(`${this.apiBaseURL}/cover/${this.coverType}/set?position=${roundedTarget / 100}`, {method: 'POST'});
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
