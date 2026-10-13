import { readNonce } from './login-nonce.cookie.js';
import { newToken } from './secrets.js';

describe('readNonce', () => {
  it('accepts a generated token', () => {
    const nonce = newToken();
    expect(readNonce(nonce)).toBe(nonce);
  });

  it.each([undefined, 42, '', 'short', `${newToken()}x`, `${newToken().slice(1)}!`, ['a']])(
    'rejects %j',
    (value) => {
      expect(readNonce(value)).toBeUndefined();
    },
  );
});
