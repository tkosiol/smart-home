import { describe, expect, it } from 'vitest';
import { SSE_CONNECTED, SSE_PING, sseEvent } from './sse.js';

describe('sse', () => {
  it('has comment frames for connect and ping', () => {
    expect(SSE_CONNECTED).toBe(': connected\n\n');
    expect(SSE_PING).toBe(': ping\n\n');
  });

  it('formats an event with a JSON data line', () => {
    expect(sseEvent('device.state', { id: 'a' })).toBe('event: device.state\ndata: {"id":"a"}\n\n');
  });

  it('keeps a line break inside a string on one data line', () => {
    const frame = sseEvent('device.state', { name: 'a\nb\r\nc' });
    expect(frame.split('\n').filter((line) => line.startsWith('data:'))).toHaveLength(1);
    expect(frame.endsWith('\n\n')).toBe(true);
    expect(frame.slice(0, -2).includes('\r')).toBe(false);
    const json = frame.split('\n')[1].slice('data: '.length);
    expect(JSON.parse(json)).toEqual({ name: 'a\nb\r\nc' });
  });
});
