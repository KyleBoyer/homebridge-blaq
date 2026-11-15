import { CharacteristicValue, Service } from 'homebridge';

import { ENTITY_KEYS } from '../utils/entity-ids.js';
import { EntityState } from '../transport/types.js';
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
    const action = target ? 'turn_on' : 'turn_off';
    if(target !== this.isOn){
      await this.sendCommand(ENTITY_KEYS.light, { action });
    }
  }

  handleStateEvent(state: EntityState){
    super.handleStateEvent(state);
    if(this.synced && state.type === 'onoff' && ENTITY_KEYS.light.includes(state.key)){
      this.setPowerState(state.on);
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
