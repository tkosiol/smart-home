import { EventEmitter } from 'node:events';
import {
  DEVICE_CHANGED,
  DeviceEvents,
  HARDWARE_CHANGED,
  type DevicesRepository,
  type HardwareRepository,
} from '../devices/index.js';
import {
  GATEWAY_REGISTERED,
  GATEWAY_REVOKED,
  GATEWAY_STATUS_CHANGED,
  GATEWAY_TOUCHED,
  GatewayEvents,
  type GatewaysService,
} from '../gateways/index.js';
import { ATTENTION_CHANGED, AttentionEvents, type AttentionService } from '../attention/index.js';
import type { Audience, LiveHub } from './live-hub.js';
import { LivePublisher } from './live-publisher.js';

const view = (id: string) => ({
  id,
  name: `Device ${id}`,
  icon: null,
  createdAt: new Date('2026-10-01T10:00:00.000Z'),
  hardware: { id: 'hw-1', vendor: 'Acme', model: 'AY-303Z', description: null },
  gatewayId: 'gw-1',
  availability: 'online',
  lastSeenAt: null,
  state: {},
  capabilities: [],
  kind: 'other',
  thresholds: {},
});

interface Fakes {
  deviceEvents: DeviceEvents;
  gatewayEvents: GatewayEvents;
  attentionEvents: AttentionEvents;
  hub: {
    watching: ReturnType<typeof vi.fn>;
    publish: ReturnType<typeof vi.fn>;
    publishByAudience: ReturnType<typeof vi.fn>;
  };
  devices: { get: ReturnType<typeof vi.fn> };
  hardware: { listingOf: ReturnType<typeof vi.fn> };
  gateways: { find: ReturnType<typeof vi.fn> };
  attention: { list: ReturnType<typeof vi.fn> };
  publisher: LivePublisher;
}

const setup = (): Fakes => {
  const deviceEvents = new DeviceEvents();
  const gatewayEvents = new GatewayEvents();
  const attentionEvents = new AttentionEvents();
  const hub = {
    watching: vi.fn(() => true),
    publish: vi.fn(),
    publishByAudience: vi.fn(),
  };
  const devices = { get: vi.fn((_h: string, id: string) => Promise.resolve(view(id))) };
  const hardware = { listingOf: vi.fn() };
  const gateways = { find: vi.fn() };
  const attention = { list: vi.fn(() => []) };
  const publisher = new LivePublisher(
    hub as unknown as LiveHub,
    deviceEvents,
    gatewayEvents,
    attentionEvents,
    devices as unknown as DevicesRepository,
    hardware as unknown as HardwareRepository,
    gateways as unknown as GatewaysService,
    attention as unknown as AttentionService,
    { heartbeatMs: 1000, throttleMs: 100 },
  );
  publisher.onModuleInit();
  return {
    deviceEvents,
    gatewayEvents,
    attentionEvents,
    hub,
    devices,
    hardware,
    gateways,
    attention,
    publisher,
  };
};

describe('LivePublisher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('publishes a changed device to viewers', async () => {
    const f = setup();
    f.deviceEvents.emit(DEVICE_CHANGED, { householdId: 'h1', deviceId: 'd1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.hub.publish).toHaveBeenCalledWith(
      'h1',
      'device.state',
      expect.objectContaining({ id: 'd1', name: 'Device d1' }),
      'viewer',
    );
    f.publisher.onModuleDestroy();
  });

  it('builds nothing when nobody watches, and nothing for a device that is gone', async () => {
    const f = setup();
    f.hub.watching.mockReturnValue(false);
    f.deviceEvents.emit(DEVICE_CHANGED, { householdId: 'h1', deviceId: 'd1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.devices.get).not.toHaveBeenCalled();

    f.hub.watching.mockReturnValue(true);
    f.devices.get.mockResolvedValue(undefined);
    f.deviceEvents.emit(DEVICE_CHANGED, { householdId: 'h1', deviceId: 'd2' });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.hub.publish).not.toHaveBeenCalled();
    f.publisher.onModuleDestroy();
  });

  it('builds twice for ten changes within the window', async () => {
    const f = setup();
    for (let index = 0; index < 10; index += 1) {
      f.deviceEvents.emit(DEVICE_CHANGED, { householdId: 'h1', deviceId: 'd1' });
      await vi.advanceTimersByTimeAsync(10);
    }
    await vi.advanceTimersByTimeAsync(200);
    expect(f.devices.get).toHaveBeenCalledTimes(2);
    expect(f.hub.publish).toHaveBeenCalledTimes(2);
    f.publisher.onModuleDestroy();
  });

  it('publishes free hardware as updated and bound or gone hardware as removed, to owners', async () => {
    const f = setup();
    f.hardware.listingOf.mockResolvedValueOnce({
      householdId: 'h1',
      listed: { id: 'hw-1', gatewayId: 'gw-1', capabilities: [] },
    });
    f.deviceEvents.emit(HARDWARE_CHANGED, { hardwareId: 'hw-1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.hub.publish).toHaveBeenLastCalledWith(
      'h1',
      'hardware.updated',
      expect.objectContaining({ id: 'hw-1' }),
      'owner',
    );

    f.hardware.listingOf.mockResolvedValueOnce({ householdId: 'h1', listed: null });
    f.deviceEvents.emit(HARDWARE_CHANGED, { hardwareId: 'hw-2' });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.hub.publish).toHaveBeenLastCalledWith(
      'h1',
      'hardware.removed',
      { id: 'hw-2' },
      'owner',
    );

    f.hardware.listingOf.mockResolvedValueOnce(undefined);
    f.deviceEvents.emit(HARDWARE_CHANGED, { hardwareId: 'hw-3' });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.hub.publish).toHaveBeenCalledTimes(2);
    f.publisher.onModuleDestroy();
  });

  it.each([GATEWAY_STATUS_CHANGED, GATEWAY_REGISTERED, GATEWAY_REVOKED, GATEWAY_TOUCHED])(
    'publishes the gateway to owners on %s',
    async (event) => {
      const f = setup();
      f.gateways.find.mockResolvedValue({ householdId: 'h1', gateway: { id: 'gw-1' } });
      f.gatewayEvents.emit(event, { gatewayId: 'gw-1' });
      await vi.advanceTimersByTimeAsync(0);
      expect(f.hub.publish).toHaveBeenCalledWith('h1', 'gateway.status', { id: 'gw-1' }, 'owner');
      f.publisher.onModuleDestroy();
    },
  );

  it('publishes nothing for an unknown gateway', async () => {
    const f = setup();
    f.gateways.find.mockResolvedValue(undefined);
    f.gatewayEvents.emit(GATEWAY_TOUCHED, { gatewayId: 'gw-9' });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.hub.publish).not.toHaveBeenCalled();
    f.publisher.onModuleDestroy();
  });

  it('builds attention per audience, only when watched', async () => {
    const f = setup();
    f.attention.list.mockReturnValue([{ id: 'x' }]);
    f.hub.publishByAudience.mockImplementation(
      (_h: string, _t: string, build: (audience: Audience) => unknown) =>
        build({ role: 'owner', isPlatformAdmin: false }),
    );
    f.attentionEvents.emit(ATTENTION_CHANGED, { householdId: 'h1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.hub.publishByAudience).toHaveBeenCalledWith(
      'h1',
      'attention.changed',
      expect.any(Function),
    );
    expect(f.attention.list).toHaveBeenCalledWith('h1', 'owner', false);

    f.hub.watching.mockReturnValue(false);
    f.hub.publishByAudience.mockClear();
    await vi.advanceTimersByTimeAsync(200);
    f.attentionEvents.emit(ATTENTION_CHANGED, { householdId: 'h1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.hub.publishByAudience).not.toHaveBeenCalled();
    f.publisher.onModuleDestroy();
  });

  it('drops only the event whose build fails and never throws into the emitter', async () => {
    const f = setup();
    f.devices.get.mockRejectedValueOnce(new Error('db away'));
    expect(() =>
      f.deviceEvents.emit(DEVICE_CHANGED, { householdId: 'h1', deviceId: 'd1' }),
    ).not.toThrow();
    f.deviceEvents.emit(DEVICE_CHANGED, { householdId: 'h1', deviceId: 'd2' });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.hub.publish).toHaveBeenCalledTimes(1);
    expect(f.hub.publish).toHaveBeenCalledWith(
      'h1',
      'device.state',
      expect.objectContaining({ id: 'd2' }),
      'viewer',
    );
    f.publisher.onModuleDestroy();
  });

  it('stops listening on destroy', async () => {
    const f = setup();
    f.publisher.onModuleDestroy();
    f.deviceEvents.emit(DEVICE_CHANGED, { householdId: 'h1', deviceId: 'd1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.devices.get).not.toHaveBeenCalled();
    expect(f.deviceEvents).toBeInstanceOf(EventEmitter);
  });
});
