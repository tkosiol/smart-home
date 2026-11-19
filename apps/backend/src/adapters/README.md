# adapters

One folder per gateway kind (`z2m`, later `ha`, …). An adapter translates between its system's
topics and payloads and the neutral contract in `core/adapters` (events in, commands out).

- Stateless: what it needs per piece of hardware is stored by the core (`native`) and handed back.
- May use `core/*` and `platform/*` through their `index.ts`; never another adapter or `modules/*`.
- Registered once in `app.module.ts` (`AdaptersModule.forRoot`); its kind is listed in `GATEWAY_KINDS`.
- Enforced by `boundaries/dependencies` (see `tools/lint-config`).
