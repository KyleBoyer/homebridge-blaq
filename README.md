<p align="center">

<img src="https://github.com/homebridge/branding/raw/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>

<span align="center">

# Homebridge Plugin for Konnected's GDO BlaQ

</span>

Konnected's GDO BlaQ device is an interface to garage door openers from Liftmaster, Chamberlain, and others.
You can purchase a GDO BlaQ device here: [Konnected Store](https://konnected.io/KYLEBOYER)

This plugin enables the use of a GDO BlaQ device with Homebridge (and derivatives like HOOBS). It supports most of the same features available to the GDO BlaQ REST API. This includes garage door/light/lock controls as well as some sensor data. The full list is below:

* Garage Door Status/Control
* Garage Light Status/Control
* Garage Remote Lock Status/Control
* Garage Learn Mode Status/Control
* Firmware Version Status
* Motion Sensor Status
* Play Pre-close Warning
* Obstruction Sensor Status (coming soon on v0.2.X)

It *could*, but does not currently, support:

* Toggle Only Mode
* Restart GDO BlaQ Device
* Resync GDO BlaQ Device
* Factory Reset GDO BlaQ Device
* Reset door timings
* Security protocol selection

Please request these features via the issues section on this repo if you would find them useful.

### Configuration

First, ensure you have fully setup your GDO BlaQ device. If you have not purchased one, you can do so here: [Konnected Store](https://konnected.io/KYLEBOYER)

Once you've installed this plugin into Homebridge, it will automatically attempt to discover GDO BlaQ devices using mDNS. If auto discovery does not work, the configuration is very straightforward - just use the GUI. If, for whatever reason, you don't want to do so, all you need to supply is a name, port, and host, like so:

```json
{
    "platform": "BlaQHomebridgePlugin",
    "name": "BlaQHomebridgePlugin",
    "devices": [
        {
            "displayName": "West Garage Door",
            "port": 80,
            "host": "10.0.1.17",
            "mac": "00:11:22:33:44:55:66"
        },
        {
            "displayName": "East Garage Door",
            "port": 80,
            "host": "10.0.1.38"
        }
    ]
}
```

The `mac` field is optional, but is quite helpful if provided - this field is used to automatically update the connection if the IP address changes.

### Implementation

GDO BlaQ devices expose a [real-time event source API](https://esphome.io/web-api/index.html?highlight=events#event-source-api) as `/events`. This allows the plugin to stay up to date with no lag. The plugin caches the most recent status we've received for each accessory, enabling immediate replies to any status checks. For controlling, the GDO BlaQ devices have a [REST API](https://konnected.readme.io/v2.0/reference/introduction) that is automatically enabled. Therefore, this plugin uses the API routes exposed for sending commands to control different accessories.

### Legal

\* Liftmaster, Chamberlain, and other terms used on this page may be names or trademarks of one or more entities. No endorsement of nor involvement in this project is expressed nor implied by any usage of their names or marks in this document.
