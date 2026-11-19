import { AddressBook } from './address-book.js';

describe('AddressBook', () => {
  it('keeps the addresses of each gateway apart', () => {
    const book = new AddressBook();
    book.replace('gw-a', [{ address: 'lamp', id: 'h1' }]);
    book.replace('gw-b', [{ address: 'lamp', id: 'h2' }]);
    expect(book.lookup('gw-a', 'lamp')).toBe('h1');
    expect(book.lookup('gw-b', 'lamp')).toBe('h2');
    expect(book.lookup('gw-c', 'lamp')).toBeUndefined();
  });

  it('forgets addresses that a new list no longer has', () => {
    const book = new AddressBook();
    book.replace('gw-a', [{ address: 'old', id: 'h1' }]);
    book.replace('gw-a', [{ address: 'new', id: 'h1' }]);
    expect(book.lookup('gw-a', 'old')).toBeUndefined();
    expect(book.lookup('gw-a', 'new')).toBe('h1');
  });

  it('moves readdressed hardware and drops the old address', () => {
    const book = new AddressBook();
    book.set('gw-a', 'old', 'h1');
    book.move('gw-a', 'old', 'new', 'h1');
    expect(book.lookup('gw-a', 'old')).toBeUndefined();
    expect(book.lookup('gw-a', 'new')).toBe('h1');
  });

  it('removes one address and forgets a whole gateway', () => {
    const book = new AddressBook();
    book.set('gw-a', 'x', 'h1');
    book.set('gw-a', 'y', 'h2');
    book.remove('gw-a', 'x');
    expect(book.lookup('gw-a', 'x')).toBeUndefined();
    expect(book.lookup('gw-a', 'y')).toBe('h2');
    book.forget('gw-a');
    expect(book.lookup('gw-a', 'y')).toBeUndefined();
  });
});
