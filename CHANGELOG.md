# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries up to and including 0.4.1 were backfilled from the [GitHub releases][releases]; the
release notes remain the canonical record for those versions.

## [0.4.1] - 2026-08-20

### Fixed

- Corrected the **Garage door device type** setting's title in the Homebridge UI, which a
  copy-paste error had left labeled as the obstruction sensor toggle. The setting itself always
  worked — only its label was wrong.
- Clarified the two options so the difference is obvious at a glance: "Garage Door (open/close)"
  vs. "Window Covering (open/close + positional control)". Thanks to
  [@TraGicCode](https://github.com/TraGicCode) ([#9]).

## [0.4.0] - 2026-08-01

ESPHome 2026.7 / 2026.8 compatibility. ESPHome changed how entities are addressed, which broke
the plugin in two separate ways: 2026.7 removed the object_id REST paths (`/cover/garage_door`
started returning 404, failing every command), and 2026.8 removed the SSE `name_id` field and
changed `id` to `cover/Garage Door`, which stopped every state update from matching — including
the device ID lookup that gates accessory publication.

### Added

- Runtime endpoint discovery: entity REST paths are now learned from the device's own SSE stream,
  per Konnected's [recommended pattern][discovery], instead of being hardcoded.
- Automatic URL fallback: commands try the discovered path, then the display-name path
  (`/cover/Garage%20Door`), then the legacy object_id path (`/cover/garage_door`), falling through
  on 404 and remembering what worked.

### Changed

- State matching is now version-agnostic — legacy ids, transitional `name_id`, and the new `id`
  format all normalize to the same stable key.
- Releases publish to npm via GitHub OIDC trusted publishing, with SLSA provenance attested
  automatically.

### Fixed

- Entities renamed in custom firmware (for example, a cover not named "Garage Door") now resolve
  via discovery rather than silently failing.

No configuration changes are required.

## [0.3.0] - 2025-07-28

### Changed

- Dependency updates.
- npm publishing now happens from GitHub Actions.

## [0.2.37] - 2025-07-20

### Changed

- README update.

## [0.2.36] - 2025-07-20

### Changed

- README update.

> Never published to npm; superseded by 0.2.37.

## [0.2.35] - 2025-06-15

### Changed

- Updated Node and Homebridge version constraints.

## [0.2.34] - 2024-09-22

### Changed

- Removed noisy logging.

### Fixed

- Check before iterating over `this.config.devices`.

## [0.2.33] - 2024-09-22

Same contents as 0.2.34.

> Never published to npm; superseded by 0.2.34.

## [0.2.32] - 2024-08-13

### Added

- Support for user/pass when accessing the GDO blaQ Native API.

## [0.2.31] - 2024-08-07

### Added

- Option to turn the Native API heartbeat on and off, to prevent random device restarts. Turning
  it on requires re-saving the plugin config.

## [0.2.30] - 2024-08-04

### Fixed

- Reset sync state on eventsource reconnection from the hub.

## [0.2.29] - 2024-08-04

### Fixed

- Reset sync state when reconnecting; debounce set/update commands for 100ms.

> Tagged only — no GitHub release, and never published to npm. Superseded by 0.2.30.

## [0.2.28] - 2024-08-03

### Fixed

- Don't update accessory states while the device is not yet synced.

## [0.2.27] - 2024-08-02

### Changed

- Corrected and expanded debug logging.

## [0.2.26] - 2024-08-02

### Changed

- More verbose logging around target and current door state.

## [0.2.25] - 2024-08-01

### Fixed

- Format and compare MAC addresses the same way across config and discovery (probable fix for
  [#2]).

## [0.2.24] - 2024-07-30

### Changed

- README links updated.

## [0.2.23] - 2024-07-27

### Changed

- Accessory services disabled or switched via the config are now removed automatically. May
  require multiple child bridge restarts.

## [0.2.22] - 2024-07-27

### Added

- Garage door type can be changed to "window covering" for positional controls.

## [0.2.21] - 2024-07-24

### Changed

- Plugin logging now differentiates between GDO blaQ devices.

## [0.2.20] - 2024-07-23

### Fixed

- Cache events before the accessories are initialized so the state stays up to date.

## [0.2.19] - 2024-07-23

### Fixed

- "No Response" error on startup.

## [0.2.18] - 2024-07-23

> **Skip this version.** A bug introduced in 0.2.17 is still present; upgrade to 0.2.19 or later.

### Changed

- Casing now matches how Konnected defines the product name (GDO BlaQ → GDO blaQ).

## [0.2.17] - 2024-07-23

> **Skip this version.** It introduced a bug that was fixed in 0.2.19.

### Changed

- Code deduplication.

### Fixed

- Accessory manufacturer / model / serial / name info.

## [0.2.16] - 2024-07-15

### Changed

- `package.json` updates.

## [0.2.15] - 2024-07-15

### Changed

- Update target door state with pre-close warning.

## [0.2.14] - 2024-07-15

### Fixed

- Fixed a crash and improved state updates for positional control.

## [0.2.13] - 2024-07-15

> **Skip this version.** It contains a bug fixed in 0.2.14.

### Fixed

- Garage door position percentage fixes.

## [0.2.12] - 2024-07-15

> Re-save your Homebridge config for this plugin if you upgraded recently — new checkboxes were
> added to enable/disable certain accessories. Fresh installs are unaffected.

### Changed

- Update the garage lock target state characteristic.

## [0.2.11] - 2024-07-15

### Added

- Setter for the garage target lock state.

## [0.2.10] - 2024-07-15

### Changed

- Display name updates.

## [0.2.9] - 2024-07-15

### Changed

- Show as a combined garage door device instead of individual items.

## [0.2.8] - 2024-07-15

### Fixed

- Fixed a crash with an undefined state event.

## [0.2.7] - 2024-07-15

### Added

- Obstruction sensor.

## [0.2.6] - 2024-07-13

### Added

- Learn mode switch.

## [0.2.5] - 2024-07-13

### Fixed

- Pre-close warning control.

## [0.2.4] - 2024-07-13

### Added

- Pre-close warning "outlet" button.

## [0.2.3] - 2024-07-13

### Changed

- Version number increase only.

## [0.2.2] - 2024-07-13

### Added

- Motion sensor accessory.

### Changed

- README updates.

> Never published to npm; superseded by 0.2.3.

## [0.2.1] - 2024-07-12

### Added

- Name in the config schema.
- More keywords in `package.json`.

## [0.2.0] - 2024-07-12

Initial release.

[releases]: https://github.com/KyleBoyer/homebridge-blaq/releases
[discovery]: https://konnected.readme.io/reference/endpoint-discovery-pattern
[#2]: https://github.com/KyleBoyer/homebridge-blaq/issues/2
[#9]: https://github.com/KyleBoyer/homebridge-blaq/pull/9

[0.4.1]: https://github.com/KyleBoyer/homebridge-blaq/compare/V0.4.0...V0.4.1
[0.4.0]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.3.0...V0.4.0
[0.3.0]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.37...0.3.0
[0.2.37]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.36...0.2.37
[0.2.36]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.35...0.2.36
[0.2.35]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.34...0.2.35
[0.2.34]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.33...0.2.34
[0.2.33]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.32...0.2.33
[0.2.32]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.31...0.2.32
[0.2.31]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.30...0.2.31
[0.2.30]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.29...0.2.30
[0.2.29]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.28...0.2.29
[0.2.28]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.27...0.2.28
[0.2.27]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.26...0.2.27
[0.2.26]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.25...0.2.26
[0.2.25]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.24...0.2.25
[0.2.24]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.23...0.2.24
[0.2.23]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.22...0.2.23
[0.2.22]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.21...0.2.22
[0.2.21]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.20...0.2.21
[0.2.20]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.19...0.2.20
[0.2.19]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.18...0.2.19
[0.2.18]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.17...0.2.18
[0.2.17]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.16...0.2.17
[0.2.16]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.15...0.2.16
[0.2.15]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.14...0.2.15
[0.2.14]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.13...0.2.14
[0.2.13]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.12...0.2.13
[0.2.12]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.11...0.2.12
[0.2.11]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.10...0.2.11
[0.2.10]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.9...0.2.10
[0.2.9]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.8...0.2.9
[0.2.8]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.7...0.2.8
[0.2.7]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.6...0.2.7
[0.2.6]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.5...0.2.6
[0.2.5]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.4...0.2.5
[0.2.4]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.3...0.2.4
[0.2.3]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.2...0.2.3
[0.2.2]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.1...0.2.2
[0.2.1]: https://github.com/KyleBoyer/homebridge-blaq/compare/0.2.0...0.2.1
[0.2.0]: https://github.com/KyleBoyer/homebridge-blaq/releases/tag/0.2.0
