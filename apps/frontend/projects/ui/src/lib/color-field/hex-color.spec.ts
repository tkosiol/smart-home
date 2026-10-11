import { normalizeHexColor } from './hex-color';

describe('normalizeHexColor', () => {
  it.each([
    ['#6f9d2f', '#6f9d2f'],
    ['6F9D2F', '#6f9d2f'],
    ['  #ABC ', '#aabbcc'],
    ['abc', '#aabbcc'],
  ])('accepts %j as %j', (raw, expected) => {
    expect(normalizeHexColor(raw)).toBe(expected);
  });

  it.each(['', '#12', '#12345', '#1234567', 'red', '#ggg000', 'rgb(0,0,0)'])(
    'rejects %j',
    (raw) => {
      expect(normalizeHexColor(raw)).toBeNull();
    },
  );
});
