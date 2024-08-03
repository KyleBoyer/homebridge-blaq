import { CharacteristicValue, Service } from 'homebridge';
import fetch from 'node-fetch'; // I am, in fact, trying to make fetch happen.

import {
  BlaQButtonEvent,
} from '../types.js';
import { LogMessageEvent, StateUpdateMessageEvent, StateUpdateRecord } from '../utils/eventsource.js';
import { BaseBlaQAccessory, BaseBlaQAccessoryConstructorParams } from './base.js';

export const label = 'Learn/Pair Mode';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class BlaQGarageLearnModeAccessory extends BaseBlaQAccessory {
  private switchService: Service;
  private isOn?: boolean;

  constructor(args: BaseBlaQAccessoryConstructorParams) {
    super(args);
    this.switchService = this.getOrAddService(this.platform.service.Switch);

    // Set the service name.  This is what is displayed as the name on the Home
    // app.  We use what we stored in `accessory.context` in  `discoverDevices`.
    this.switchService.setCharacteristic(this.platform.characteristic.Name, this.accessory.context.device.displayName + ' ' + label);

    this.switchService.getCharacteristic(this.platform.characteristic.On)
      .onGet(this.getIsOn.bind(this))
      .onSet(this.changeIsOn.bind(this));
    this.logger.debug(`Initialized ${this.getSelfClassName()}!`);
  }

  getIsOn(): CharacteristicValue {
    return this.isOn || false;
  }

  setIsOn(isOn: boolean) {
    this.isOn = isOn;
    this.switchService.setCharacteristic(
      this.platform.characteristic.On,
      this.isOn,
    );
  }

  private async changeIsOn(target: CharacteristicValue){
    const apiTarget: string = target ? 'turn_on' : 'turn_off';
    if(target !== this.isOn){ // only call the API when target = true (button on)
      await fetch(`${this.apiBaseURL}/switch/learn/${apiTarget}`, {method: 'POST'});
    }
  }

  handleStateEvent(stateEvent: StateUpdateMessageEvent){
    super.handleStateEvent(stateEvent);
    if(!this.synced){
      return;
    }
    try {
      const stateInfo = JSON.parse(stateEvent.data) as StateUpdateRecord;
      if (['switch-learn'].includes(stateInfo.id)) {
        const buttonEvent = stateInfo as BlaQButtonEvent & { state?: 'ON' | 'OFF' };
        if(['OFF', 'ON'].includes(buttonEvent.state?.toUpperCase() || '')){
          this.setIsOn(buttonEvent.state?.toUpperCase() === 'ON');
        }
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
      const learnTurningOn =
        lowercaseLogStr.includes('learn') &&
        lowercaseLogStr.includes('turning') &&
        lowercaseLogStr.includes('on');
      const learnStateOn =
        lowercaseLogStr.includes('learn') &&
        lowercaseLogStr.includes('state') &&
        lowercaseLogStr.includes('on');
      const learnTurningOff =
        lowercaseLogStr.includes('learn') &&
        lowercaseLogStr.includes('turning') &&
        lowercaseLogStr.includes('off');
      const learnStateOff =
        lowercaseLogStr.includes('learn') &&
        lowercaseLogStr.includes('state') &&
        lowercaseLogStr.includes('off');
      if (learnTurningOn || learnStateOn) {
        this.setIsOn(true);
      } else if (learnTurningOff || learnStateOff) {
        this.setIsOn(false);
      }
    } catch(e) {
      this.logger.error('Log parsing error:', e);
    }
  }
}
