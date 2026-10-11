# ADR-0011: Angular Material gekapselt in `@smart/ui`

- Status: angenommen
- Datum: 2026-10-11

## Kontext

Die UI soll ausschließlich aus Shared Components bestehen und M3 folgen.

## Entscheidung

Angular Material ist internes Detail von `@smart/ui`; Features ohne eigenes CSS; nur Design-Tokens; alles per Lint erzwungen.

## Konsequenzen

Fehlende UI erfordert eine neue `ui-*`-Komponente; einheitliches Erscheinungsbild ist technisch gesichert.

Details: Spec, Abschnitt 10.2, 10.3.
