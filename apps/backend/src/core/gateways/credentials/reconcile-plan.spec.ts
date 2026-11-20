import { describe, expect, it } from 'vitest';
import { planReconcile } from './reconcile-plan.js';

describe('planReconcile', () => {
  it('creates a missing user', () => {
    expect(planReconcile([{ id: 'gw-00000001', generation: 1 }], [])).toEqual([
      { kind: 'create', id: 'gw-00000001', generation: 1 },
    ]);
  });

  it('leaves a user with the same generation alone', () => {
    expect(
      planReconcile(
        [{ id: 'gw-00000001', generation: 2 }],
        [{ username: 'gw-00000001', textdescription: 'generation:2' }],
      ),
    ).toEqual([]);
  });

  it('rekeys a user whose generation differs or is not stated', () => {
    expect(
      planReconcile(
        [
          { id: 'gw-00000001', generation: 3 },
          { id: 'gw-00000002', generation: 1 },
        ],
        [{ username: 'gw-00000001', textdescription: 'generation:2' }, { username: 'gw-00000002' }],
      ),
    ).toEqual([
      { kind: 'rekey', id: 'gw-00000001', generation: 3 },
      { kind: 'rekey', id: 'gw-00000002', generation: 1 },
    ]);
  });

  it('rekeys a user whose description is ahead of the database (a rekey half done)', () => {
    // A pairing's rekey set the description, then failed; its transaction rolled back to 2.
    expect(
      planReconcile(
        [{ id: 'gw-00000001', generation: 2 }],
        [{ username: 'gw-00000001', textdescription: 'generation:3' }],
      ),
    ).toEqual([{ kind: 'rekey', id: 'gw-00000001', generation: 2 }]);
  });

  it('deletes a user without a wanted gateway', () => {
    expect(
      planReconcile([], [{ username: 'gw-00000009', textdescription: 'generation:1' }]),
    ).toEqual([{ kind: 'delete', username: 'gw-00000009' }]);
  });

  it('plans nothing for empty lists', () => {
    expect(planReconcile([], [])).toEqual([]);
  });

  it('orders the steps by ID, whatever the input order', () => {
    const steps = planReconcile(
      [
        { id: 'gw-00000004', generation: 1 },
        { id: 'gw-00000002', generation: 2 },
        { id: 'gw-00000001', generation: 1 },
      ],
      [
        { username: 'gw-00000003', textdescription: 'generation:1' },
        { username: 'gw-00000002', textdescription: 'generation:1' },
        { username: 'gw-00000001', textdescription: 'generation:1' },
      ],
    );
    expect(steps).toEqual([
      { kind: 'rekey', id: 'gw-00000002', generation: 2 },
      { kind: 'delete', username: 'gw-00000003' },
      { kind: 'create', id: 'gw-00000004', generation: 1 },
    ]);
  });
});
