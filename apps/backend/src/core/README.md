# core

Device-type-agnostic domain kernel (identity, households, gateways, devices, telemetry, commands, notifications).

- One folder per core module; other folders import it only through its `index.ts`.
- Core never imports from `modules/`.
- Enforced by `boundaries/dependencies` (see `tools/lint-config`).
