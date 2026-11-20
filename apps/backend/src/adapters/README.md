# adapters

One folder per gateway kind (`z2m`: Zigbee2MQTT, `ha`: Home Assistant, …). An adapter translates between its system's
topics and payloads and the neutral contract in `core/adapters` (events in, commands out).

- Stateless: what it needs per piece of hardware is stored by the core (`native`) and handed back.
- May use `core/*` and `platform/*` through their `index.ts`; never another adapter or `modules/*`.
- Registered once in `app.module.ts` (`AdaptersModule.forRoot`); its kind is listed in `GATEWAY_KINDS`.
- Enforced by `boundaries/dependencies` (see `tools/lint-config`).

## A new kind needs

1. The module `adapters/<kind>/` (adapter, module, `index.ts`, specs) and its line in `app.module.ts`.
2. The kind in `GATEWAY_KINDS` (`packages/contracts/src/gateways.ts`), then `pnpm packages:build`.
3. A migration that recreates the check `gateways_kind_check` on `gateways.kind` with the new value
   (`ha`: `drizzle/0012_gateway_kind_ha.sql`; ADR-0021, addendum).
4. The kind's name in the frontend translations (`gateways.kind.<kind>` in `features/gateways/i18n`).
5. Broker rights for `gw/%u/<kind>/#` in `infra/broker/acl`.

`ha` reads the protocol of the integration in `integrations/home-assistant/`; both sides test against the shared
payloads in `integrations/home-assistant/fixtures/` (spec `2026-11-19-home-assistant-adapter-design.md`).
