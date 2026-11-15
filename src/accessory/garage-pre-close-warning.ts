import { CharacteristicValue, Service } from 'homebridge';

import { ENTITY_KEYS } from '../utils/entity-ids.js';
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
      await this.sendCommand(ENTITY_KEYS.preCloseWarning, { action: 'press' });
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
