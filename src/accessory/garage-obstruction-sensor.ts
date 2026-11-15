import { CharacteristicValue, Service } from 'homebridge';

import { ENTITY_KEYS } from '../utils/entity-ids.js';
import { EntityState } from '../transport/types.js';
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
    this.occupancySensorService = this.getOrAddService(this.platform.service.OccupancySensor);

    // Set the service name.  This is what is displayed as the name on the Home
    // app.  We use what we stored in `accessory.context` in  `discoverDevices`.
    this.occupancySensorService.setCharacteristic(
      this.platform.characteristic.Name,
      this.accessory.context.device.displayName + ' ' + label,
    );

    this.occupancySensorService.getCharacteristic(this.platform.characteristic.OccupancyDetected)
      .onGet(this.getObstructionDetected.bind(this));

    this.logger.debug(`Initialized ${this.getSelfClassName()}!`);
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

  handleStateEvent(state: EntityState){
    super.handleStateEvent(state);
    if(this.synced && state.type === 'onoff' && ENTITY_KEYS.obstruction.includes(state.key)){
      this.setObstructionDetected(state.on);
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
