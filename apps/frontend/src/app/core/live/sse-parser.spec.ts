import { SseParser } from './sse-parser';

describe('SseParser', () => {
  it('parses an event with data', () => {
    expect(new SseParser().push('event: device.state\ndata: {"a":1}\n\n')).toEqual([
      { event: 'device.state', data: '{"a":1}' },
    ]);
  });

  it('accepts \\n, \\r\\n and \\r as line ends', () => {
    expect(new SseParser().push('event: a\r\ndata: 1\r\n\r\n')).toEqual([
      { event: 'a', data: '1' },
    ]);
    expect(new SseParser().push('event: a\rdata: 1\r\r')).toEqual([{ event: 'a', data: '1' }]);
  });

  it('ignores comments', () => {
    expect(new SseParser().push(': connected\n\n: ping\n\n')).toEqual([]);
    expect(new SseParser().push(': x\nevent: a\ndata: 1\n\n')).toEqual([{ event: 'a', data: '1' }]);
  });

  it('joins several data lines with a line feed', () => {
    expect(new SseParser().push('data: a\ndata: b\n\n')).toEqual([
      { event: 'message', data: 'a\nb' },
    ]);
  });

  it('treats a field without colon as an empty value', () => {
    expect(new SseParser().push('data\n\n')).toEqual([{ event: 'message', data: '' }]);
  });

  it('removes only one space after the colon', () => {
    expect(new SseParser().push('data:  x\n\ndata:y\n\n')).toEqual([
      { event: 'message', data: ' x' },
      { event: 'message', data: 'y' },
    ]);
  });

  it('drops a message without data and resets the event type', () => {
    expect(new SseParser().push('event: a\n\ndata: 1\n\n')).toEqual([
      { event: 'message', data: '1' },
    ]);
  });

  it('defaults the type to message', () => {
    expect(new SseParser().push('data: 1\n\n')).toEqual([{ event: 'message', data: '1' }]);
  });

  it('handles chunks split anywhere, also inside \\r\\n', () => {
    const input = 'event: a\r\ndata: {"x":"y"}\r\n\r\nevent: b\ndata: 2\n\n';
    const expected = [
      { event: 'a', data: '{"x":"y"}' },
      { event: 'b', data: '2' },
    ];
    for (let cut = 0; cut <= input.length; cut++) {
      const parser = new SseParser();
      expect([...parser.push(input.slice(0, cut)), ...parser.push(input.slice(cut))]).toEqual(
        expected,
      );
    }
    const parser = new SseParser();
    expect([...input].flatMap((char) => parser.push(char))).toEqual(expected);
  });
});
