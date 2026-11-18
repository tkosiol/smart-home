import { Z2mAdapter } from './z2m.adapter.js';

const adapter = new Z2mAdapter();
const msg = (topic: string, payload: string | object) => ({
  gatewayId: 'gw-test0001',
  topic,
  payload: Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)),
});

describe('Z2mAdapter', () => {
  it('is the adapter of Zigbee2MQTT gateways', () => {
    expect(adapter.kind).toBe('z2m');
  });

  it('classifies topics with their size limits', () => {
    expect(adapter.classify('bridge/devices')).toEqual({ maxBytes: 4 * 1024 * 1024 });
    expect(adapter.classify('bridge/event')).toEqual({ maxBytes: 64 * 1024 });
    expect(adapter.classify('bridge/state')).toBeUndefined();
    expect(adapter.classify('bridge/request/permit_join')).toBeUndefined();
    expect(adapter.classify('Monstera/availability')).toEqual({ maxBytes: 1024 });
    expect(adapter.classify('Monstera/set')).toBeUndefined();
    expect(adapter.classify('Monstera/set/brightness')).toBeUndefined();
    expect(adapter.classify('Monstera/get')).toBeUndefined();
    expect(adapter.classify('Monstera')).toEqual({ maxBytes: 64 * 1024 });
  });

  it('hands the bridge topics to their translation', () => {
    expect(adapter.translate(msg('bridge/devices', []))).toEqual([
      { type: 'hardware.listed', hardware: [] },
    ]);
    expect(
      adapter.translate(
        msg('bridge/event', {
          type: 'device_leave',
          data: { ieee_address: '0x00000000000000a7' },
        }),
      ),
    ).toEqual([{ type: 'hardware.left', externalId: '0x00000000000000a7' }]);
  });

  it('reports nothing for the topics it does not classify', () => {
    expect(adapter.translate(msg('bridge/state', 'online'))).toEqual([]);
    expect(adapter.translate(msg('Monstera/set', { state: 'ON' }))).toEqual([]);
  });

  it('turns device messages into a report and a sign of life', () => {
    expect(adapter.translate(msg('Monstera', { soil_moisture: 40 }))).toEqual([
      { type: 'hardware.report', ref: { address: 'Monstera' }, native: { soil_moisture: 40 } },
      { type: 'activity' },
    ]);
    expect(adapter.translate(msg('Monstera', '[1,2]'))).toEqual([{ type: 'activity' }]);
    expect(adapter.translate(msg('Monstera', 'garbage'))).toEqual([{ type: 'activity' }]);
  });

  it('keeps slashes in a device name', () => {
    expect(adapter.translate(msg('Garten/Beet 2', { battery: 80 }))[0]).toMatchObject({
      ref: { address: 'Garten/Beet 2' },
    });
    expect(adapter.translate(msg('Garten/Beet 2/availability', 'online'))[0]).toMatchObject({
      ref: { address: 'Garten/Beet 2' },
    });
  });

  it('turns availability into events', () => {
    expect(adapter.translate(msg('Monstera/availability', 'offline'))).toEqual([
      { type: 'hardware.availability', ref: { address: 'Monstera' }, availability: 'offline' },
      { type: 'activity' },
    ]);
    expect(adapter.translate(msg('Monstera/availability', { state: 'online' }))[0]).toMatchObject({
      availability: 'online',
    });
    expect(adapter.translate(msg('Monstera/availability', 'maybe'))).toEqual([
      { type: 'activity' },
    ]);
    expect(adapter.translate(msg('Monstera/availability', { state: 'sleeping' }))).toEqual([
      { type: 'activity' },
    ]);
  });

  it('decodes reports', () => {
    const decoded = adapter.decodeReport({ battery: 80 }, [
      {
        key: 'battery',
        kind: 'numeric',
        unit: '%',
        min: 0,
        max: 100,
        step: null,
        enumValues: null,
        readable: true,
        writable: false,
        isSetting: false,
        native: { property: 'battery' },
      },
    ]);
    expect(decoded).toEqual({ values: { battery: 80 }, measuredAt: undefined });
  });

  it('reads the service status', () => {
    expect(adapter.serviceStatusTopic).toBe('bridge/state');
    expect(adapter.parseServiceStatus(Buffer.from('online'))).toBe('online');
    expect(adapter.parseServiceStatus(Buffer.from(' offline\n'))).toBe('offline');
    expect(adapter.parseServiceStatus(Buffer.from('{"state":"offline"}'))).toBe('offline');
    expect(adapter.parseServiceStatus(Buffer.from('{"state":"sleeping"}'))).toBeUndefined();
    expect(adapter.parseServiceStatus(Buffer.from('{broken'))).toBeUndefined();
    expect(adapter.parseServiceStatus(Buffer.from('maybe'))).toBeUndefined();
    expect(adapter.parseServiceStatus(Buffer.from('x'.repeat(2000)))).toBeUndefined();
  });
});
