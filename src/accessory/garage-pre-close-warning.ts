import { CharacteristicValue, Service } from 'homebridge';
import fetch from 'node-fetch'; // I am, in fact, trying to make fetch happen.

import {
  BlaQButtonEvent,
} from '../types.js';
import { LogMessageEvent, StateUpdateMessageEvent, StateUpdateRecord } from '../utils/eventsource.js';
import { BaseBlaQAccessory, BaseBlaQAccessoryConstructorParams } from './base.js';

export const label = 'Pre-close Warning';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class BlaQGaragePreCloseWarningAccessory extends BaseBlaQAccessory {
  private outletService: Service;
  private isOn?: boolean;

  constructor(args: BaseBlaQAccessoryConstructorParams) {
    super(args);
    this.outletService = this.getOrAddService(this.platform.service.Outlet);

    // Set the service name.  This is what is displayed as the name on the Home
    // app.  We use what we stored in `accessory.context` in  `discoverDevices`.
    this.outletService.setCharacteristic(this.platform.characteristic.Name, this.accessory.context.device.displayName + ' ' + label);

    this.outletService.getCharacteristic(this.platform.characteristic.On)
      .onGet(this.getIsOn.bind(this))
      .onSet(this.changeIsOn.bind(this));
    this.logger.debug(`Initialized ${this.getSelfClassName()}!`);
  }

  getIsOn(): CharacteristicValue {
    return this.isOn || false;
  }

  setIsOn(isOn: boolean) {
    this.isOn = isOn;
    this.outletService.setCharacteristic(
      this.platform.characteristic.On,
      this.isOn,
    );
  }

  private async changeIsOn(target: CharacteristicValue){
    if(target && target !== this.isOn){ // only call the API when target = true (button on)
      await fetch(`${this.apiBaseURL}/button/pre-close_warning/press`, {method: 'POST'});
    }
  }

  handleStateEvent(stateEvent: StateUpdateMessageEvent){
    super.handleStateEvent(stateEvent);
    if(!this.synced){
      return;
    }
    try {
      const stateInfo = JSON.parse(stateEvent.data) as StateUpdateRecord;
      if (['button-pre-close_warning'].includes(stateInfo.id)) {
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
      const preCloseWarningPressed =
        lowercaseLogStr.includes('pre') &&
        lowercaseLogStr.includes('close') &&
        lowercaseLogStr.includes('warning') &&
        lowercaseLogStr.includes('pressed');
      const playSoundPressed =
        lowercaseLogStr.includes('play') &&
        lowercaseLogStr.includes('sound') &&
        lowercaseLogStr.includes('pressed');
      const playingSong =
        lowercaseLogStr.includes('playing') &&
        lowercaseLogStr.includes('song');
      const playbackFinished =
        lowercaseLogStr.includes('playback') &&
        lowercaseLogStr.includes('finished');
      if (preCloseWarningPressed || playSoundPressed || playingSong) {
        this.setIsOn(true);
      } else if (playbackFinished) {
        this.setIsOn(false);
      }
    } catch(e) {
      this.logger.error('Log parsing error:', e);
    }
  }
}
