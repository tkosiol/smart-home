/**
 * Which hardware an adapter's address stands for, per gateway: two gateways may use the same
 * address for different hardware. Held in memory (one entry per piece of hardware), built from the
 * database when a gateway is followed and after every list of its hardware.
 */
export class AddressBook {
  private readonly byGateway = new Map<string, Map<string, string>>();

  /** Replaces all addresses of the gateway. */
  replace(gatewayId: string, entries: Iterable<{ address: string; id: string }>): void {
    this.byGateway.set(gatewayId, new Map([...entries].map((e) => [e.address, e.id])));
  }

  lookup(gatewayId: string, address: string): string | undefined {
    return this.byGateway.get(gatewayId)?.get(address);
  }

  set(gatewayId: string, address: string, hardwareId: string): void {
    const addresses = this.byGateway.get(gatewayId) ?? new Map<string, string>();
    addresses.set(address, hardwareId);
    this.byGateway.set(gatewayId, addresses);
  }

  remove(gatewayId: string, address: string): void {
    this.byGateway.get(gatewayId)?.delete(address);
  }

  /** Moves the hardware to its new address; the old one no longer leads anywhere. */
  move(gatewayId: string, from: string, to: string, hardwareId: string): void {
    this.remove(gatewayId, from);
    this.set(gatewayId, to, hardwareId);
  }

  /** Drops everything known of the gateway (it was revoked). */
  forget(gatewayId: string): void {
    this.byGateway.delete(gatewayId);
  }
}
