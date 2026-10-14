/**
 * Which hardware a Zigbee2MQTT `friendly_name` stands for, per gateway: two gateways may use the
 * same name for different hardware. Held in memory (one entry per piece of hardware), built from
 * the database on start and from the bridge's device list.
 */
export class NameMap {
  private readonly byGateway = new Map<string, Map<string, string>>();

  /** Replaces all names of the gateway. */
  replace(gatewayId: string, entries: Iterable<{ friendlyName: string; id: string }>): void {
    this.byGateway.set(gatewayId, new Map([...entries].map((e) => [e.friendlyName, e.id])));
  }

  lookup(gatewayId: string, friendlyName: string): string | undefined {
    return this.byGateway.get(gatewayId)?.get(friendlyName);
  }

  set(gatewayId: string, friendlyName: string, hardwareId: string): void {
    const names = this.byGateway.get(gatewayId) ?? new Map<string, string>();
    names.set(friendlyName, hardwareId);
    this.byGateway.set(gatewayId, names);
  }

  remove(gatewayId: string, friendlyName: string): void {
    this.byGateway.get(gatewayId)?.delete(friendlyName);
  }

  /** Moves the hardware to its new name; the old name no longer leads anywhere. */
  rename(gatewayId: string, from: string, to: string, hardwareId: string): void {
    this.remove(gatewayId, from);
    this.set(gatewayId, to, hardwareId);
  }

  /** Drops everything known of the gateway (it was revoked). */
  forget(gatewayId: string): void {
    this.byGateway.delete(gatewayId);
  }
}
