import { CharacteristicValue, Service } from 'homebridge';

import {
  BlaQBinarySensorEvent,
} from '../types.js';
import { LogMessageEvent, StateUpdateMessageEvent, StateUpdateRecord } from '../utils/eventsource.js';
import { BaseBlaQAccessory, BaseBlaQAccessoryConstructorParams } from './base.js';

export const label = 'Obstruction Sensor';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class BlaQGarageObstructionSensorAccessory extends BaseBlaQAccessory {
  private occupancySensorService: Service;
  private obstructionDetected?: boolean;

  constructor(args: BaseBlaQAccessoryConstructorParams) {
    super(args);
    this.logger.debug('Initializing BlaQGarageObstructionSensorAccessory...');
    this.occupancySensorService = this.getOrAddService(this.platform.service.OccupancySensor);

    // Set the service name.  This is what is displayed as the name on the Home
    // app.  We use what we stored in `accessory.context` in  `discoverDevices`.
    this.occupancySensorService.setCharacteristic(
      this.platform.characteristic.Name,
      this.accessory.context.device.displayName + ' ' + label,
    );

    this.occupancySensorService.getCharacteristic(this.platform.characteristic.OccupancyDetected)
      .onGet(this.getObstructionDetected.bind(this));

    this.logger.debug('Initialized BlaQGarageObstructionSensorAccessory!');
  }

  getObstructionDetected(): CharacteristicValue {
    return this.obstructionDetected || false;
  }

  setObstructionDetected(obstructionDetected: boolean) {
    this.obstructionDetected = obstructionDetected;
    this.occupancySensorService.setCharacteristic(
      this.platform.characteristic.OccupancyDetected,
      this.obstructionDetected,
    );
  }

  handleStateEvent(stateEvent: StateUpdateMessageEvent){
    super.handleStateEvent(stateEvent);
    try {
      const stateInfo = JSON.parse(stateEvent.data) as StateUpdateRecord;
      if (['binary_sensor-obstruction'].includes(stateInfo.id)) {
        const sensorEvent = stateInfo as BlaQBinarySensorEvent;
        if(['OFF', 'ON'].includes(sensorEvent.state.toUpperCase())){
          this.setObstructionDetected(sensorEvent.state.toUpperCase() === 'ON');
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
      const obstructionStateOn =
        lowercaseLogStr.includes('obstruction') && lowercaseLogStr.includes('state') && lowercaseLogStr.includes('on');
      const obstructionStateOff =
        lowercaseLogStr.includes('obstruction') && lowercaseLogStr.includes('state') && lowercaseLogStr.includes('off');
      const obstructionObstructed =
        lowercaseLogStr.includes('obstruction') && lowercaseLogStr.includes('obstructed');
      const obstructionClear =
        lowercaseLogStr.includes('obstruction') && lowercaseLogStr.includes('clear');
      if (obstructionStateOn || obstructionObstructed) {
        this.setObstructionDetected(true);
      } else if (obstructionStateOff || obstructionClear) {
        this.setObstructionDetected(false);
      }
    } catch(e) {
      this.logger.error('Log parsing error:', e);
    }
  }
}
