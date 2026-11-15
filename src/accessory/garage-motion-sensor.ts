import { CharacteristicValue, Service } from 'homebridge';

import { ENTITY_KEYS } from '../utils/entity-ids.js';
import { EntityState } from '../transport/types.js';
import { BaseBlaQAccessory, BaseBlaQAccessoryConstructorParams } from './base.js';


export const label = 'Motion Sensor';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class BlaQGarageMotionSensorAccessory extends BaseBlaQAccessory {
  private motionSensorService: Service;
  private motionDetected?: boolean;

  constructor(args: BaseBlaQAccessoryConstructorParams) {
    super(args);
    this.motionSensorService = this.getOrAddService(this.platform.service.MotionSensor);

    // Set the service name.  This is what is displayed as the name on the Home
    // app.  We use what we stored in `accessory.context` in  `discoverDevices`.
    this.motionSensorService.setCharacteristic(this.platform.characteristic.Name, this.accessory.context.device.displayName + ' ' + label);

    this.motionSensorService.getCharacteristic(this.platform.characteristic.MotionDetected)
      .onGet(this.getMotionDetected.bind(this));

    this.logger.debug(`Initialized ${this.getSelfClassName()}!`);
  }

  getMotionDetected(): CharacteristicValue {
    return this.motionDetected || false;
  }

  setMotionDetected(motionDetected: boolean) {
    this.motionDetected = motionDetected;
    this.motionSensorService.setCharacteristic(
      this.platform.characteristic.MotionDetected,
      this.motionDetected,
    );
  }

  handleStateEvent(state: EntityState){
    super.handleStateEvent(state);
    if(this.synced && state.type === 'onoff' && ENTITY_KEYS.motion.includes(state.key)){
      this.setMotionDetected(state.on);
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
      if (lowercaseLogStr.includes('motion') && lowercaseLogStr.includes('state') && lowercaseLogStr.includes('on')) {
        this.setMotionDetected(true);
      } else if (lowercaseLogStr.includes('motion') && lowercaseLogStr.includes('state') && lowercaseLogStr.includes('off')) {
        this.setMotionDetected(false);
      }
    } catch(e) {
      this.logger.error('Log parsing error:', e);
    }
  }
}
