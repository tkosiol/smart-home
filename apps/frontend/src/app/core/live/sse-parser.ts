export interface SseMessage {
  event: string;
  data: string;
}

/** Incremental parser of a `text/event-stream` body; chunks may end anywhere. */
export class SseParser {
  private buffer = '';
  /** The last chunk ended with `\r`: a `\n` at the start of the next one belongs to it. */
  private skipLineFeed = false;
  private event = '';
  private data: string[] = [];

  push(chunk: string): SseMessage[] {
    if (this.skipLineFeed && chunk.startsWith('\n')) chunk = chunk.slice(1);
    if (chunk !== '') this.skipLineFeed = chunk.endsWith('\r');
    const text = this.buffer + chunk;
    const messages: SseMessage[] = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char !== '\n' && char !== '\r') continue;
      this.line(text.slice(start, i), messages);
      if (char === '\r' && text[i + 1] === '\n') i++;
      start = i + 1;
    }
    this.buffer = text.slice(start);
    return messages;
  }

  private line(line: string, messages: SseMessage[]): void {
    if (line === '') {
      if (this.data.length > 0) {
        messages.push({ event: this.event || 'message', data: this.data.join('\n') });
      }
      this.event = '';
      this.data = [];
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
  }
}
