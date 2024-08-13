import { CharacteristicValue, Service } from 'homebridge';

import {
  BlaQButtonEvent,
  GarageLightType,
} from '../types.js';
import { LogMessageEvent, StateUpdateMessageEvent, StateUpdateRecord } from '../utils/eventsource.js';
import { BaseBlaQAccessory, BaseBlaQAccessoryConstructorParams } from './base.js';

const LIGHT_PREFIX = 'light-';

export const label = 'Light';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class BlaQGarageLightAccessory extends BaseBlaQAccessory {
  private lightbulbService: Service;
  private isOn?: boolean;
  private lightType?: GarageLightType = 'garage_light';

  constructor(args: BaseBlaQAccessoryConstructorParams) {
    super(args);
    this.lightbulbService = this.getOrAddService(this.platform.service.Lightbulb);

    // Set the service name.  This is what is displayed as the name on the Home
    // app.  We use what we stored in `accessory.context` in  `discoverDevices`.
    this.lightbulbService.setCharacteristic(this.platform.characteristic.Name, this.accessory.context.device.displayName + ' ' + label);

    this.lightbulbService.getCharacteristic(this.platform.characteristic.On)
      .onGet(this.getPowerState.bind(this))
      .onSet(this.changePowerState.bind(this));

    this.logger.debug(`Initialized ${this.getSelfClassName()}!`);
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
      await this.authFetch(`${this.apiBaseURL}/light/${this.lightType}/${apiTarget}`, {method: 'POST'});
    }
  }

  handleStateEvent(stateEvent: StateUpdateMessageEvent){
    super.handleStateEvent(stateEvent);
    if(!this.synced){
      return;
    }
    try {
      const stateInfo = JSON.parse(stateEvent.data) as StateUpdateRecord;
      if (['light-garage_light', 'light-light'].includes(stateInfo.id)) {
        const buttonEvent = stateInfo as BlaQButtonEvent & { state?: 'ON' | 'OFF' };
        this.lightType = stateInfo.id.split(LIGHT_PREFIX).pop() as GarageLightType;
        if(['OFF', 'ON'].includes(buttonEvent.state?.toUpperCase() || '')){
          this.setPowerState(buttonEvent.state?.toUpperCase() === 'ON');
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
