/**
 * What a topic below a gateway's Zigbee2MQTT prefix is, by its remainder (`<name>`, `bridge/…`).
 * The device ingest and the gateway status share these rules.
 */

/** `<name>/set`, `<name>/set/<attribute>` and the same with `get`: commands, not device messages. */
const COMMAND_TOPIC = /\/(?:set|get)(?:\/[^/]+)?$/;

export const isCommandTopic = (rest: string): boolean => COMMAND_TOPIC.test(rest);

/** Zigbee2MQTT's own topics: the device list, events, status and requests to the bridge. */
export const isBridgeTopic = (rest: string): boolean => rest.startsWith('bridge/');

/** A message or availability of a device: no sign of Zigbee2MQTT working if it is anything else. */
export const isDeviceTraffic = (rest: string): boolean =>
  !isBridgeTopic(rest) && !isCommandTopic(rest);
