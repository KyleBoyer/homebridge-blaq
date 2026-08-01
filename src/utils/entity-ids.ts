import { StateUpdateRecord } from './eventsource.js';

/**
 * ESPHome changed the way entities are addressed, and Konnected's firmware follows along.
 * See https://konnected.readme.io/reference/api-migration-guide-for-esphome-20267
 *
 * REST paths:
 *   < 2026.7   `/cover/garage_door`      (sanitized object_id)
 *   >= 2026.1.3 `/cover/Garage%20Door`   (URL-encoded display name; both formats accepted)
 *   >= 2026.7   object_id paths are removed and return 404
 *
 * SSE payload identifiers:
 *   < 2026.1.3        `id` is `cover-garage_door`
 *   2026.1.3 - 2026.7 `id` is `cover-garage_door` and `name_id` is `cover/Garage Door`
 *   >= 2026.8         `name_id` is gone and `id` is `cover/Garage Door`
 *
 * Everything here normalizes both shapes down to the legacy `${domain}-${object_id}` key, so the
 * accessories can keep matching on stable identifiers like `cover-garage_door` no matter which
 * firmware the device runs, while REST paths get discovered from what the device itself reports.
 */

/** Domains that used hyphens rather than underscores in the pre-2026.1.3 SSE `id` field. */
const HYPHENATED_DOMAINS = ['binary-sensor', 'text-sensor', 'alarm-control-panel'];

/**
 * Every identifier we accept for a given logical entity, most likely first.
 *
 * Firmware revisions and custom builds name things differently, and the published REST reference
 * doesn't always agree with the devices: it documents the pre-close warning button as
 * `pre_close_warning`, while devices report `pre-close_warning` (ESPHome's sanitizer keeps hyphens,
 * which is also what makes `Security+ protocol` come out as `security__protocol`). Rather than
 * betting on one spelling, state updates match any key in the group and commands fall back through
 * all of them.
 */
export const ENTITY_KEYS: Record<string, string[]> = {
  cover: ['cover-garage_door', 'cover-door'],
  light: ['light-garage_light', 'light-light'],
  lock: ['lock-lock', 'lock-lock_remotes'],
  learnMode: ['switch-learn'],
  preCloseWarning: ['button-pre-close_warning', 'button-pre_close_warning'],
  motion: ['binary_sensor-motion'],
  obstruction: ['binary_sensor-obstruction'],
  synced: ['binary_sensor-synced'],
  deviceID: ['text_sensor-device_id'],
  firmwareVersion: ['text_sensor-esphome_version', 'text_sensor-firmware_version'],
};

/**
 * Display names of the entities we send commands to, keyed by their legacy identifier. Only used
 * as a fallback when we haven't (yet) seen the entity on the SSE stream: on firmware that dropped
 * the object_id paths, guessing the stock name beats guessing nothing.
 */
export const KNOWN_ENTITY_DISPLAY_NAMES: Record<string, string> = {
  'cover-garage_door': 'Garage Door',
  'cover-door': 'Door',
  'light-garage_light': 'Garage Light',
  'light-light': 'Light',
  'lock-lock': 'Lock',
  'lock-lock_remotes': 'Lock remotes',
  'switch-learn': 'Learn',
  'button-pre-close_warning': 'Pre-close Warning',
  'button-pre_close_warning': 'Pre-close Warning',
};

export type ParsedEntityID = {
  /** ESPHome domain, always underscored (`binary_sensor`, `cover`, ...) */
  domain: string;
  /** Sanitized object_id (`garage_door`), derived from the display name when necessary */
  objectID: string;
  /** Display name, known only when the device reported a new-format identifier */
  displayName?: string;
  /** Legacy-style `${domain}-${objectID}` identifier, stable across firmware versions */
  key: string;
  /** REST path for this entity in the format the reporting device accepts */
  path: string;
};

/** ESPHome's object_id sanitizer: lowercase, and anything outside [a-z0-9_-] becomes an underscore. */
export const sanitizeObjectID = (displayName: string): string =>
  displayName.toLowerCase().replaceAll(/[^a-z0-9_-]/g, '_');

/** Pre-2026.7 REST path, e.g. `/cover/garage_door` */
export const buildLegacyEntityPath = (domain: string, objectID: string): string =>
  `/${domain}/${objectID}`;

/** 2026.1.3+ REST path, e.g. `/cover/Garage%20Door` */
export const buildNamedEntityPath = (domain: string, displayName: string): string =>
  `/${domain}/${encodeURIComponent(displayName)}`;

/** Splits either identifier format into its domain and object_id, plus the REST path it implies. */
export const parseEntityID = (rawID?: string): ParsedEntityID | undefined => {
  if(!rawID){
    return undefined;
  }
  const slashIndex = rawID.indexOf('/');
  if(slashIndex > 0){
    // New format: `cover/Garage Door`
    const domain = rawID.slice(0, slashIndex);
    const displayName = rawID.slice(slashIndex + 1);
    const objectID = sanitizeObjectID(displayName);
    return {
      domain,
      objectID,
      displayName,
      key: `${domain}-${objectID}`,
      path: buildNamedEntityPath(domain, displayName),
    };
  }
  // Legacy format: `cover-garage_door`, or `binary-sensor-motion` on pre-2026.1.3 firmware.
  // Note that object_ids may themselves contain hyphens (`button-pre-close_warning`), so we can
  // only split on the first hyphen once the hyphenated domains are accounted for.
  const hyphenatedDomain = HYPHENATED_DOMAINS.find(domain => rawID.startsWith(`${domain}-`));
  const separatorIndex = hyphenatedDomain ? hyphenatedDomain.length : rawID.indexOf('-');
  if(separatorIndex <= 0){
    return undefined;
  }
  const domain = rawID.slice(0, separatorIndex).replaceAll('-', '_');
  const objectID = rawID.slice(separatorIndex + 1);
  return {
    domain,
    objectID,
    key: `${domain}-${objectID}`,
    path: buildLegacyEntityPath(domain, objectID),
  };
};

/** Prefers `name_id` when the firmware provides it, since `id` is the legacy field until 2026.8. */
export const getEntityID = (record: StateUpdateRecord): string =>
  (typeof record.name_id === 'string' && record.name_id) || record.id;

export const parseStateRecord = (record: StateUpdateRecord): ParsedEntityID | undefined =>
  parseEntityID(getEntityID(record));

/** True when a parsed identifier is any of the accepted spellings for an entity. */
export const isEntity = (entity: ParsedEntityID | undefined, entityKeys: string[]): boolean =>
  !!entity && entityKeys.includes(entity.key);

/**
 * REST paths worth trying for an entity, best-first: whatever the device advertised over SSE, then
 * the display-name paths (the only format ESPHome >= 2026.7 answers), then the object_id paths (the
 * only format ESPHome < 2026.1.3 answers). Each tier covers every accepted spelling of the entity
 * before the next tier starts guessing.
 */
export const buildEntityPathCandidates = (entityKeys: string[], discoveredPaths: Map<string, string>): string[] => {
  const parsed = entityKeys.map(entityKey => ({entityKey, entity: parseEntityID(entityKey)}));
  const candidates = [
    ...entityKeys.map(entityKey => discoveredPaths.get(entityKey)),
    ...parsed.map(({entityKey, entity}) => {
      const displayName = KNOWN_ENTITY_DISPLAY_NAMES[entityKey];
      return entity && displayName ? buildNamedEntityPath(entity.domain, displayName) : undefined;
    }),
    ...parsed.map(({entity}) => entity && buildLegacyEntityPath(entity.domain, entity.objectID)),
  ].filter((path): path is string => !!path);
  return [...new Set(candidates)];
};
