import { InjectionToken } from '@angular/core';

/** The part of an ECharts instance the chart uses (so tests can stand in for ECharts). */
export interface ChartHandle {
  setOption(option: Record<string, unknown>, opts?: { notMerge?: boolean }): void;
  resize(): void;
  dispatchAction(action: { type: string; [key: string]: unknown }): void;
  on(event: string, handler: (event: never) => void): void;
  dispose(): void;
}

export interface ChartEngine {
  init(host: HTMLElement): ChartHandle;
}

/**
 * Loads ECharts, tree-shaken to what the chart needs, with the SVG renderer. This is the only
 * place that reaches ECharts, and only through `import()`: it lands in its own lazy chunk, never
 * in the initial bundle. (`echarts-setup.ts` holds the static named imports, which the bundler
 * can tree-shake, unlike the namespace of a dynamic `import('echarts/charts')`.)
 */
export async function loadEcharts(): Promise<ChartEngine> {
  return (await import('./echarts-setup')).engine;
}

/** How the chart gets ECharts; tests and stories may provide a stand-in. */
export const ECHARTS_LOADER = new InjectionToken<() => Promise<ChartEngine>>('ECHARTS_LOADER', {
  providedIn: 'root',
  factory: () => loadEcharts,
});
