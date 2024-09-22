import { API, Categories, Characteristic, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import * as Bonjour from 'bonjour-service';

import { BlaQHub } from './hub.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { ConfigDevice } from './types.js';
import { formatMAC } from './utils/formatters.js';

const maskPassword = (d: ConfigDevice) => {
  if(d.password){
    return {
      ...d,
      password: '***',
    };
  }
  return d;
};

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class BlaQHomebridgePluginPlatform implements DynamicPlatformPlugin {
  public readonly service: typeof Service;
  public readonly characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  private hubs: Record<string, BlaQHub> = {};
  private hubAccessories: Record<string, PlatformAccessory[]> = {};
  private bonjourInstance: Bonjour.Bonjour;

  constructor(
    public readonly logger: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.api = api;
    this.service = this.api.hap.Service;
    this.characteristic = this.api.hap.Characteristic;
    this.bonjourInstance = new Bonjour.Bonjour();
    this.logger.debug('Finished initializing platform:', this.config.name || this.config.platform);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      logger.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.logger.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  getDeviceKey(device: ConfigDevice) {
    const correctedMAC = formatMAC(device.mac);
    if(correctedMAC && this.hubs[correctedMAC]) {
      return correctedMAC;
    }
    if(this.hubs[device.host]) {
      return device.host;
    }
    return correctedMAC || device.host;
  }

  possiblyRegisterNewDevice(device: ConfigDevice){
    const deviceKey = this.getDeviceKey(device);
    if(!this.hubs[deviceKey]) {
      this.hubs[deviceKey] = new BlaQHub(this.config, device, this.registerDiscoveredDevice.bind(this), this.logger);
      this.hubAccessories[deviceKey] = [];
    }else{
      const existingDiscoverer = this.hubs[deviceKey];
      existingDiscoverer.updateHostPort(device.host, device.port);
    }
  }

  possiblyMergeWithManualConfigDevice(deviceToMerge: ConfigDevice){
    let manualConfigDevice = {};
    if(Array.isArray(this.config.devices)){
      for (const configDevice of this.config.devices as ConfigDevice[]) {
        const matchingMAC = configDevice.mac && formatMAC(configDevice.mac) === formatMAC(deviceToMerge.mac);
        const matchingHost = configDevice.host && configDevice.host.toLowerCase() === deviceToMerge.host.toLowerCase();
        if(matchingMAC || matchingHost){
          manualConfigDevice = configDevice;
        }
      }
    }
    return {
      ...manualConfigDevice,
      ...deviceToMerge,
    };
  }

  searchBonjour(){
    this.bonjourInstance.find({
      type: 'konnected',
      protocol: 'tcp',
      txt: {
        web_api: 'true',
      },
    }, (service) => {
      const isGarageProject =
        service.txt?.project_name?.toLowerCase()?.includes('garage') ||
        service.txt?.project_name?.toLowerCase()?.includes('gdo');
      if(service.txt?.web_api === 'true' && isGarageProject){
        const configEntry: ConfigDevice = this.possiblyMergeWithManualConfigDevice({
          host: service.addresses?.[0] || service.host,
          port: service.port,
          displayName: service.txt?.friendly_name,
          mac: formatMAC(service.txt?.mac),
        });
        this.logger.debug(`Discovered device via mDNS: ${JSON.stringify(maskPassword(configEntry))}`);
        this.possiblyRegisterNewDevice(configEntry);
      }
    });
  }

  /**
   * For each configured device, launch a Discovery probe to fetch its metadata.
   * Once that probe completes, we'll register the relevant accessory.
   */
  discoverDevices() {
    this.searchBonjour();
    const FIVE_MINUTES_IN_MS = 5 * 60 * 1000;
    setInterval(() => this.searchBonjour(), FIVE_MINUTES_IN_MS);
    if(Array.isArray(this.config.devices)){
      for (const configDevice of this.config.devices as ConfigDevice[]) {
        this.logger.debug(`Discovered device via manual config: ${JSON.stringify(maskPassword(configDevice))}`);
        this.possiblyRegisterNewDevice(configDevice);
      }
    }
  }

  registerDiscoveredDevice(configDevice: ConfigDevice, model: string, serialnumber: string): {
    platform: BlaQHomebridgePluginPlatform;
    accessory: PlatformAccessory;
  } {
    this.logger.info(`Running registerDiscovered callback for ${model} #${serialnumber}...`);
    const correctedMAC = formatMAC(configDevice.mac);
    // TODO: This would be the spot to add a UUID override to enable the user to transparently replace a device
    const uuid = this.api.hap.uuid.generate(correctedMAC || serialnumber);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
    const configDeviceKey = this.getDeviceKey(configDevice);
    if (existingAccessory) {
      // refresh services
      this.logger.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      existingAccessory.context.device = configDevice;
      this.api.updatePlatformAccessories(this.hubAccessories[configDeviceKey] || [existingAccessory]);
      existingAccessory.services.forEach(service => existingAccessory.removeService(service));
      return { platform: this, accessory: existingAccessory };
    } else {
      this.logger.info(`Adding new accessory: ${model} #${serialnumber}`);
      const accessory = new this.api.platformAccessory(configDevice.displayName, uuid, Categories.GARAGE_DOOR_OPENER);
      accessory.context.device = configDevice;
      this.hubAccessories[this.getDeviceKey(configDevice)].push(accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.hubAccessories[configDeviceKey]);
      return { platform: this, accessory };
    }
  }
}
