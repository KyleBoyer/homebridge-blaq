import { CharacteristicValue, Logger, PlatformAccessory, Service, WithUUID } from 'homebridge';
import fetch from 'node-fetch'; // I am, in fact, trying to make fetch happen.
import { LogMessageEvent, PingMessageEvent, StateUpdateMessageEvent, StateUpdateRecord } from '../utils/eventsource';
import { BlaQHomebridgePluginPlatform } from '../platform';
import { BlaQTextSensorEvent } from '../types';
import {
  ENTITY_KEYS,
  buildEntityPathCandidates,
  isEntity,
  parseStateRecord,
} from '../utils/entity-ids.js';
import type { RequestInfo, RequestInit, Response } from 'node-fetch';

export interface BaseBlaQAccessoryInterface {
    setAPIBaseURL: (apiBaseURL: string) => void;
    handleStateEvent: (stateEvent: StateUpdateMessageEvent) => void;
    handleLogEvent?: (logEvent: LogMessageEvent) => void;
    handlePingEvent?: (pingEvent: PingMessageEvent) => void;
    resetSyncState: () => void;
}

export type BaseBlaQAccessoryConstructorParams = {
    accessory: PlatformAccessory;
    apiBaseURL: string;
    apiUser?: string;
    apiPass?: string;
    friendlyName: string;
    platform: BlaQHomebridgePluginPlatform;
    serialNumber: string;
};

export const correctAPIBaseURL = (inputURL: string) => {
  let correctedAPIBaseURL = inputURL;
  if(!correctedAPIBaseURL.includes('://')){
    correctedAPIBaseURL = `http://${correctedAPIBaseURL}`;
  }
  if(correctedAPIBaseURL.endsWith('/')){
    correctedAPIBaseURL = correctedAPIBaseURL.slice(0, -1);
  }
  return correctedAPIBaseURL;
};

export class BaseBlaQAccessory implements BaseBlaQAccessoryInterface {
  protected apiBaseURL: string;
  protected user?: string;
  protected pass?: string;
  protected firmwareVersion?: string;
  protected synced?: boolean;
  protected queuedEvents: {
    type: 'state' | 'log' | 'ping';
    event: StateUpdateMessageEvent | LogMessageEvent | PingMessageEvent;
  }[] = [];

  /** Legacy entity key -> REST path that this device is known to accept. */
  private readonly entityPaths: Map<string, string> = new Map();

  protected readonly accessory: PlatformAccessory;
  protected readonly accessoryInformationService: Service;
  protected readonly logger: Logger;
  protected readonly friendlyName: string;
  protected readonly platform: BlaQHomebridgePluginPlatform;
  protected readonly serialNumber: string;

  constructor({
    accessory,
    apiBaseURL,
    apiUser,
    apiPass,
    friendlyName,
    platform,
    serialNumber,
  }: BaseBlaQAccessoryConstructorParams){
    this.platform = platform;
    this.logger = this.platform.logger;
    this.logger.debug(`Initializing ${this.getSelfClassName()}...`);
    this.accessory = accessory;
    this.friendlyName = friendlyName;
    this.serialNumber = serialNumber;
    this.apiBaseURL = correctAPIBaseURL(apiBaseURL);
    this.user = apiUser;
    this.pass = apiPass;
    this.accessoryInformationService = this.getOrAddService(this.platform.service.AccessoryInformation);
    // set accessory information
    this.accessoryInformationService
      .setCharacteristic(this.platform.characteristic.Manufacturer, 'Konnected')
      .setCharacteristic(this.platform.characteristic.Model, 'GDO blaQ')
      .setCharacteristic(this.platform.characteristic.SerialNumber, this.serialNumber)
      .setCharacteristic(this.platform.characteristic.Name, this.friendlyName);
    // Publish firmware version; this may not be initialized yet, so we set a getter.
    // Note that this is against the AccessoryInformation service, not the GDO service.
    this.accessoryInformationService
      .getCharacteristic(this.platform.characteristic.FirmwareRevision)
      .onGet(this.getFirmwareVersion.bind(this));
  }

  protected getSelfClassName() {
    return this.constructor.name;
  }

  protected getOrAddService(service: WithUUID<typeof Service> | Service): Service {
    return this.accessory.getService(service as WithUUID<typeof Service>) ||
        this.accessory.addService(service as Service);
  }

  protected removeService(service: WithUUID<typeof Service> | Service): void{
    const foundService = this.accessory.getService(service as WithUUID<typeof Service>);
    if(foundService){
      this.accessory.removeService(foundService);
    }
  }

  processQueuedEvents() {
    while(this.queuedEvents.length){
      const event = this.queuedEvents.shift()!;
      const funcToCall = {
        'ping': (this as BaseBlaQAccessoryInterface).handlePingEvent?.bind(this),
        'log': (this as BaseBlaQAccessoryInterface).handleLogEvent?.bind(this),
        'state': (this as BaseBlaQAccessoryInterface).handleStateEvent?.bind(this),
      }[event.type];
      if(funcToCall){
        funcToCall(event.event);
      }
    }
  }

  resetSyncState(){
    this.synced = false;
  }

  handlePingEvent(pingEvent: PingMessageEvent){
    if(!this.synced){
      this.queuedEvents.push({type: 'ping', event: pingEvent});
    }
  }

  handleLogEvent(logEvent: LogMessageEvent){
    if(!this.synced){
      this.queuedEvents.push({type: 'log', event: logEvent});
    }
  }

  handleStateEvent(stateEvent: StateUpdateMessageEvent): void {
    try {
      const stateInfo = JSON.parse(stateEvent.data) as StateUpdateRecord;
      const entity = parseStateRecord(stateInfo);
      if (entity) {
        // The device is the source of truth for its own URLs, so remember what it told us.
        this.entityPaths.set(entity.key, entity.path);
      }
      if (isEntity(entity, ENTITY_KEYS.synced)) {
        this.synced = stateInfo.value as boolean | undefined;
        if(this.synced){
          this.processQueuedEvents();
        }
      }else if (isEntity(entity, ENTITY_KEYS.firmwareVersion)) {
        const b = stateInfo as BlaQTextSensorEvent;
        if (b.value && b.value === b.state) {
          this.setFirmwareVersion(b.value);
        } else {
          this.logger.error('Mismatched firmware versions in value/state:', b.value, b.state);
          this.firmwareVersion = undefined;
        }
      } else if(!this.synced){
        this.queuedEvents.push({type: 'state', event: stateEvent});
      }
    } catch(e) {
      this.logger.error('Cannot deserialize message:', stateEvent);
      this.logger.error('Deserialization yielded:', e);
    }
  }

  getFirmwareVersion(): CharacteristicValue {
    return this.firmwareVersion || '';
  }

  protected setFirmwareVersion(version: string) {
    this.firmwareVersion = version;
    this.accessoryInformationService.setCharacteristic(
      this.platform.characteristic.FirmwareRevision,
      version,
    );
  }

  setAPIBaseURL(url: string){
    this.apiBaseURL = correctAPIBaseURL(url);
  }

  /**
   * POSTs an action to an entity, falling back through the known URL formats on a 404 so that the
   * same code works against firmware from either side of the ESPHome 2026.7 URL change, and
   * regardless of which spelling of the entity's object_id the device settled on.
   */
  protected async entityFetch(entityKeys: string[], action?: string, query?: string): Promise<Response | undefined> {
    const suffix = `${action ? `/${action}` : ''}${query ? `?${query}` : ''}`;
    const candidates = buildEntityPathCandidates(entityKeys, this.entityPaths);
    let response: Response | undefined;
    for(const path of candidates){
      response = await this.authFetch(`${this.apiBaseURL}${path}${suffix}`, {method: 'POST'});
      if(response.status !== 404){
        this.entityPaths.set(entityKeys[0], path); // skip straight to this one next time
        return response;
      }
      this.logger.debug(`Got a 404 for ${path}${suffix}; trying the next known URL format...`);
    }
    if(!response){
      this.logger.error(`Cannot build a URL for unrecognized entity: ${entityKeys.join(', ')}`);
    }else{
      this.logger.error(`No known URL format worked for ${entityKeys[0]}; tried: ${candidates.join(', ')}`);
    }
    return response;
  }

  protected authFetch(url: URL | RequestInfo, init?: RequestInit){
    const newInit = init || {};
    const basicCreds = `${this.user}:${this.pass}`;
    newInit['headers'] = {
      ...newInit['headers'],
      ...(this.user && this.pass ? {
        'Authorization': `Basic ${Buffer.from(basicCreds).toString('base64')}`,
      } : {}),
    };
    return fetch(url, newInit);
  }
}