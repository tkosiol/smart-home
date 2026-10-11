# modules

Feature modules (e.g. `plants`, `heating`). Each owns its tables (`*.schema.ts`, table prefix = module name), logic and API.

- May use `core/*` and `platform/*` through their `index.ts`.
- Must never import another feature module; react to core domain events instead.
- Enforced by `boundaries/dependencies` (see `tools/lint-config`).
