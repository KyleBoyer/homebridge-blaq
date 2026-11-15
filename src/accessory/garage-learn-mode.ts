import { CharacteristicValue, Service } from 'homebridge';

import { ENTITY_KEYS } from '../utils/entity-ids.js';
import { EntityState } from '../transport/types.js';
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
    const action = target ? 'turn_on' : 'turn_off';
    if(target !== this.isOn){ // only call the API when target = true (button on)
      await this.sendCommand(ENTITY_KEYS.learnMode, { action });
    }
  }

  handleStateEvent(state: EntityState){
    super.handleStateEvent(state);
    if(this.synced && state.type === 'onoff' && ENTITY_KEYS.learnMode.includes(state.key)){
      this.setIsOn(state.on);
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
