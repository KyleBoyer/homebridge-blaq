import { CharacteristicValue, Service } from 'homebridge';

import {
  BlaQButtonEvent,
} from '../types.js';
import { ENTITY_KEYS, isEntity, parseStateRecord } from '../utils/entity-ids.js';
import { LogMessageEvent, StateUpdateMessageEvent, StateUpdateRecord } from '../utils/eventsource.js';
import { BaseBlaQAccessory, BaseBlaQAccessoryConstructorParams } from './base.js';

export const label = 'Light';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class BlaQGarageLightAccessory extends BaseBlaQAccessory {
  private lightbulbService: Service;
  private isOn?: boolean;

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
      await this.entityFetch(ENTITY_KEYS.light, apiTarget);
    }
  }

  handleStateEvent(stateEvent: StateUpdateMessageEvent){
    super.handleStateEvent(stateEvent);
    if(!this.synced){
      return;
    }
    try {
      const stateInfo = JSON.parse(stateEvent.data) as StateUpdateRecord;
      const entity = parseStateRecord(stateInfo);
      if (isEntity(entity, ENTITY_KEYS.light)) {
        const buttonEvent = stateInfo as BlaQButtonEvent & { state?: 'ON' | 'OFF' };
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
