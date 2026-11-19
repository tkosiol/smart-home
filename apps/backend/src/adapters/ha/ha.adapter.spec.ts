import { readFileSync } from 'node:fs';
import { HaAdapter } from './ha.adapter.js';

const fixtureBuffer = (name: string): Buffer =>
  readFileSync(
    new URL(`../../../../../integrations/home-assistant/fixtures/${name}.json`, import.meta.url),
  );
const ID = '0a1b2c3d4e5f60718293a4b5c6d7e8f9';
const adapter = new HaAdapter();
const message = (topic: string, payload: Buffer | string) => ({
  gatewayId: 'gw-1',
  topic,
  payload: Buffer.from(payload),
});

describe('HaAdapter', () => {
  it('is the ha kind with a status topic', () => {
    expect(adapter.kind).toBe('ha');
    expect(adapter.serviceStatusTopic).toBe('status');
  });

  describe('parseServiceStatus', () => {
    it('reads online and offline as text', () => {
      expect(adapter.parseServiceStatus(Buffer.from('online'))).toBe('online');
      expect(adapter.parseServiceStatus(Buffer.from(' offline\n'))).toBe('offline');
    });
    it('reads nothing else', () => {
      expect(adapter.parseServiceStatus(Buffer.from('{"state":"online"}'))).toBeUndefined();
      expect(adapter.parseServiceStatus(Buffer.from('1'))).toBeUndefined();
      expect(adapter.parseServiceStatus(Buffer.alloc(1025, 'a'))).toBeUndefined();
    });
  });

  describe('classify', () => {
    it('takes the list and the snapshots with their limits', () => {
      expect(adapter.classify('devices')).toEqual({ maxBytes: 4 * 1024 * 1024 });
      expect(adapter.classify(`device/${ID}`)).toEqual({ maxBytes: 64 * 1024 });
      expect(adapter.classify(`device/${'a'.repeat(64)}`)).toEqual({ maxBytes: 64 * 1024 });
    });
    it('drops everything else', () => {
      for (const topic of ['device/', 'device/a/b', `device/${'a'.repeat(65)}`, 'device/a b']) {
        expect(adapter.classify(topic)).toBeUndefined();
      }
      for (const topic of ['status', 'command', 'x', '', 'devices/x']) {
        expect(adapter.classify(topic)).toBeUndefined();
      }
    });
  });

  describe('translate', () => {
    it('lists the devices', () => {
      const events = adapter.translate(message('devices', fixtureBuffer('devices')));
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('hardware.listed');
    });

    it('reports nothing for an invalid list', () => {
      expect(adapter.translate(message('devices', '{"v":2,"devices":[]}'))).toEqual([]);
    });

    it('treats an empty snapshot as a removed device and says nothing', () => {
      expect(adapter.translate(message(`device/${ID}`, ''))).toEqual([]);
    });

    it('takes bad JSON or a wrong version as a sign of life only', () => {
      expect(adapter.translate(message(`device/${ID}`, 'nope'))).toEqual([{ type: 'activity' }]);
      expect(adapter.translate(message(`device/${ID}`, '{"v":2,"entities":{}}'))).toEqual([
        { type: 'activity' },
      ]);
      expect(adapter.translate(message(`device/${ID}`, '{"v":1}'))).toEqual([{ type: 'activity' }]);
    });

    it('turns a snapshot into a report, an availability and activity, in that order', () => {
      const payload = fixtureBuffer('device-lamp-on');
      expect(adapter.translate(message(`device/${ID}`, payload))).toEqual([
        {
          type: 'hardware.report',
          ref: { address: ID },
          native: JSON.parse(payload.toString()) as unknown,
        },
        { type: 'hardware.availability', ref: { address: ID }, availability: 'online' },
        { type: 'activity' },
      ]);
      const offline = adapter.translate(
        message(`device/${ID}`, fixtureBuffer('device-lamp-unavailable')),
      );
      expect(offline[1]).toMatchObject({ availability: 'offline' });
    });

    it('reports without an availability when the snapshot has no entity', () => {
      expect(
        adapter.translate(message(`device/${ID}`, '{"v":1,"entities":{}}')).map((e) => e.type),
      ).toEqual(['hardware.report', 'activity']);
    });

    it('ignores topics it does not know', () => {
      expect(adapter.translate(message('status', 'online'))).toEqual([]);
      expect(adapter.translate(message('command', '{}'))).toEqual([]);
    });
  });

  it('decodes a report through the decoder', () => {
    const [listed] = adapter.translate(message('devices', fixtureBuffer('devices')));
    if (listed?.type !== 'hardware.listed') throw new Error('no list');
    const native: unknown = JSON.parse(fixtureBuffer('device-lamp-on').toString());
    const decoded = adapter.decodeReport(native, listed.hardware[0]?.capabilities ?? []);
    expect(decoded.values).toMatchObject({ state: true });
  });
});
