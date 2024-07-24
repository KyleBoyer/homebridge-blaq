import { CharacteristicValue, Service } from 'homebridge';

import {
  BlaQBinarySensorEvent,
} from '../types.js';
import { LogMessageEvent, StateUpdateMessageEvent, StateUpdateRecord } from '../utils/eventsource.js';
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

  handleStateEvent(stateEvent: StateUpdateMessageEvent){
    super.handleStateEvent(stateEvent);
    try {
      const stateInfo = JSON.parse(stateEvent.data) as StateUpdateRecord;
      if (['binary_sensor-motion'].includes(stateInfo.id)) {
        const sensorEvent = stateInfo as BlaQBinarySensorEvent;
        if(['OFF', 'ON'].includes(sensorEvent.state.toUpperCase())){
          this.setMotionDetected(sensorEvent.state.toUpperCase() === 'ON');
        }
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
