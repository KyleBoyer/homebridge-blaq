import { Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { ConfigDevice } from './types.js';
import { BaseBlaQAccessoryInterface } from './accessory/base.js';
import { BlaQHomebridgePluginPlatform } from './platform.js';
import { BlaQGarageDoorAccessory } from './accessory/garage-door.js';
import { BlaQGarageLightAccessory } from './accessory/garage-light.js';
import { BlaQGarageLockAccessory } from './accessory/garage-lock.js';
import { BlaQGarageMotionSensorAccessory } from './accessory/garage-motion-sensor.js';
import { BlaQGaragePreCloseWarningAccessory } from './accessory/garage-pre-close-warning.js';
import { BlaQGarageLearnModeAccessory } from './accessory/garage-learn-mode.js';
import { BlaQGarageObstructionSensorAccessory } from './accessory/garage-obstruction-sensor.js';
import { NativeAPIHeartbeat } from './utils/native-api-heartbeat.js';
import { BlaQTransport, DeviceIdentity, EntityCommand, EntityState, TransportHandlers } from './transport/types.js';
import { NativeTransport } from './transport/native.js';
import { WebTransport } from './transport/web.js';

type FriendlyNameAndSerialNumber = {
  friendlyName: string;
  serialNumber: string;
};

type InitAccessoryParams = FriendlyNameAndSerialNumber & {
  platform: BlaQHomebridgePluginPlatform;
  accessory: PlatformAccessory;
};

export type BlaQInitAccessoryCallback = (configDevice: ConfigDevice, Model: string, SerialNumber: string) => {
  platform: BlaQHomebridgePluginPlatform;
  accessory: PlatformAccessory;
};

export type ConnectionMode = 'auto' | 'native' | 'web';

const NATIVE_RETRY_MS = 30 * 1000;

type BufferedEvent = { type: 'state'; state: EntityState } | { type: 'log'; line: string };

export class BlaQHub {
  private accessories: BaseBlaQAccessoryInterface[] = [];
  private transport?: BlaQTransport;
  private nativeAPIHeartbeat?: NativeAPIHeartbeat;
  private host: string;
  private port: number;
  private initialized = false;
  private eventsBeforeAccessoryInit: BufferedEvent[] = [];
  private readonly logPrefix: string;

  constructor(
    private readonly pluginConfig: PlatformConfig,
    private readonly configDevice: ConfigDevice,
    private readonly initAccessoryCallback: BlaQInitAccessoryCallback,
    private readonly logger: Logger,
  ) {
    logger.debug('Initializing BlaQHub...');
    this.host = configDevice.host;
    this.port = configDevice.port;
    this.logPrefix = `[${configDevice.displayName}]`;
    void this.connect();
  }

  private get handlers(): TransportHandlers {
    return {
      onState: state => this.handleState(state),
      onLog: line => this.handleLog(line),
      onIdentity: identity => this.possiblyFinalizeInit(identity),
      onConnect: () => this.accessories.forEach(accessory => accessory.resetSyncState()),
    };
  }

  // shortcut: auto mode picks a transport once, so a device offline at startup stays on the web API
  // until restart; re-probe the Native API on a timer if users hit this.
  private async connect() {
    const mode: ConnectionMode = this.pluginConfig.connectionType ?? 'auto';
    if (mode !== 'web') {
      try {
        this.transport = await NativeTransport.open({
          host: this.host,
          encryptionKey: this.configDevice.encryptionKey,
          logger: this.logger,
          logPrefix: this.logPrefix,
          handlers: this.handlers,
        });
        this.logger.info(`${this.logPrefix} Connected using the ESPHome Native API.`);
        return;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (mode === 'native') {
          this.logger.error(`${this.logPrefix} Cannot connect to the Native API (${reason}); retrying in 30 seconds.`);
          setTimeout(() => void this.connect(), NATIVE_RETRY_MS);
          return;
        }
        this.logger.info(`${this.logPrefix} Native API unavailable (${reason}); using the web server API instead.`);
      }
    }
    this.transport = new WebTransport({
      host: this.host,
      port: this.port,
      user: this.configDevice.username,
      pass: this.configDevice.password,
      logger: this.logger,
      logPrefix: this.logPrefix,
      handlers: this.handlers,
    });
    // The web server doesn't count as a Native API client, so ESPHome's reboot timer still applies.
    if (this.pluginConfig.enableNativeAPIHeartbeat) {
      this.nativeAPIHeartbeat = new NativeAPIHeartbeat({
        getHost: () => this.host,
        login: this.pluginConfig.enableNativeAPIHeartbeatLogin ?? true,
        logger: this.logger,
        logPrefix: this.logPrefix,
      });
    }
  }

  // Looked up per call: accessories can be created before connect() has stored the transport.
  private readonly sendCommand = async (entityKeys: string[], command: EntityCommand) => {
    if (!this.transport) {
      this.logger.error(`${this.logPrefix} Not connected yet; dropping command`, command);
      return;
    }
    await this.transport.command(entityKeys, command);
  };

  public updateHostPort(host: string, port: number){
    const isChanged = host !== this.host || port !== this.port;
    this.host = host;
    this.port = port;
    if(isChanged){
      this.transport?.setHost(host, port);
      this.nativeAPIHeartbeat?.restart();
    }
  }

  private possiblyFinalizeInit({ model, mac }: DeviceIdentity){
    if(this.initialized){
      return;
    }
    this.logger.info(`${this.logPrefix} [init] Publishing accessories with device model:`, model);
    this.initAccessories({ friendlyName: model, serialNumber: mac });
    this.initialized = true;
    for (const event of this.eventsBeforeAccessoryInit) {
      this.dispatch(event);
    }
    this.eventsBeforeAccessoryInit = [];
    this.logger.debug(`${this.logPrefix} [init] Accessories initialized!`);
  }

  private dispatch(event: BufferedEvent) {
    for (const accessory of this.accessories) {
      if (event.type === 'state') {
        accessory.handleStateEvent(event.state);
      } else {
        accessory.handleLogEvent?.(event.line);
      }
    }
  }

  private handleState(state: EntityState){
    this.logger.debug(`${this.logPrefix} Processing state event:`, JSON.stringify(state));
    if(!this.initialized){
      this.eventsBeforeAccessoryInit.push({ type: 'state', state });
      return;
    }
    this.dispatch({ type: 'state', state });
  }

  private handleLog(line: string){
    this.logger.debug(`${this.logPrefix} GDO blaQ log:`, line);
    if(!this.initialized){
      this.eventsBeforeAccessoryInit.push({ type: 'log', line });
      return;
    }
    this.dispatch({ type: 'log', line });
  }

  private initGarageDoorAccessory({ platform, accessory, friendlyName, serialNumber}: InitAccessoryParams){
    this.accessories.push(new BlaQGarageDoorAccessory({
      platform, accessory, friendlyName, serialNumber, type: this.pluginConfig.garageDoorType,
      sendCommand: this.sendCommand,
    }));
  }

  private initGarageLightAccessory({ platform, accessory, friendlyName, serialNumber}: InitAccessoryParams){
    if(this.pluginConfig.enableLight ?? true) {
      this.accessories.push(new BlaQGarageLightAccessory({
        platform, accessory, friendlyName, serialNumber,
        sendCommand: this.sendCommand,
      }));
    }
  }

  private initGarageLockAccessory({ platform, accessory, friendlyName, serialNumber}: InitAccessoryParams){
    if(this.pluginConfig.enableLockRemotes ?? true){
      this.accessories.push(new BlaQGarageLockAccessory({
        platform, accessory, friendlyName, serialNumber,
        sendCommand: this.sendCommand,
      }));
    }
  }

  private initGarageMotionSensorAccessory({ platform, accessory, friendlyName, serialNumber}: InitAccessoryParams){
    if(this.pluginConfig.enableMotionSensor ?? true){
      this.accessories.push(new BlaQGarageMotionSensorAccessory({
        platform, accessory, friendlyName, serialNumber,
        sendCommand: this.sendCommand,
      }));
    }
  }

  private initGaragePreCloseWarningAccessory({ platform, accessory, friendlyName, serialNumber}: InitAccessoryParams){
    if(this.pluginConfig.enablePreCloseWarning ?? true){
      this.accessories.push(new BlaQGaragePreCloseWarningAccessory({
        platform, accessory, friendlyName, serialNumber,
        sendCommand: this.sendCommand,
      }));
    }
  }

  private initGarageLearnModeAccessory({ platform, accessory, friendlyName, serialNumber}: InitAccessoryParams){
    if(this.pluginConfig.enableLearnMode ?? true){
      this.accessories.push(new BlaQGarageLearnModeAccessory({
        platform, accessory, friendlyName, serialNumber,
        sendCommand: this.sendCommand,
      }));
    }
  }

  private initGarageObstructionSensorAccessory({ platform, accessory, friendlyName, serialNumber}: InitAccessoryParams){
    if(this.pluginConfig.enableSeparateObstructionSensor ?? true){
      this.accessories.push(new BlaQGarageObstructionSensorAccessory({
        platform, accessory, friendlyName, serialNumber,
        sendCommand: this.sendCommand,
      }));
    }
  }

  private initAccessories({ friendlyName, serialNumber }: FriendlyNameAndSerialNumber){
    const {platform, accessory} = this.initAccessoryCallback(
      this.configDevice,
      friendlyName,
      serialNumber,
    );
    this.initGarageDoorAccessory({ platform, accessory, friendlyName, serialNumber });
    this.initGarageLightAccessory({ platform, accessory, friendlyName, serialNumber });
    this.initGarageLockAccessory({ platform, accessory, friendlyName, serialNumber });
    this.initGarageMotionSensorAccessory({ platform, accessory, friendlyName, serialNumber });
    this.initGaragePreCloseWarningAccessory({ platform, accessory, friendlyName, serialNumber });
    this.initGarageLearnModeAccessory({ platform, accessory, friendlyName, serialNumber });
    this.initGarageObstructionSensorAccessory({ platform, accessory, friendlyName, serialNumber });
  }
}
