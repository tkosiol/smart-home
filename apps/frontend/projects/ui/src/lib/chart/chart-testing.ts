import type { Provider } from '@angular/core';
import { ECHARTS_LOADER, type ChartEngine, type ChartHandle } from './echarts-loader';

/** A chart handle that records what it is told and draws nothing. */
export class FakeChart implements ChartHandle {
  readonly options: Record<string, unknown>[] = [];
  readonly actions: { type: string; [key: string]: unknown }[] = [];
  readonly handlers = new Map<string, (event: never) => void>();
  disposed = false;
  resized = 0;
  setOption(option: Record<string, unknown>) {
    this.options.push(option);
  }
  resize() {
    this.resized++;
  }
  dispatchAction(action: { type: string; [key: string]: unknown }) {
    this.actions.push(action);
  }
  on(event: string, handler: (event: never) => void) {
    this.handlers.set(event, handler);
  }
  dispose() {
    this.disposed = true;
  }
  /** Fires one of the registered ECharts events ("updateAxisPointer", "globalout"). */
  emit(event: string, payload: unknown = {}) {
    this.handlers.get(event)!(payload as never);
  }
}

/**
 * Lets `ui-chart` render in specs without ECharts, which would try to measure text on a canvas
 * jsdom does not have (and say so on stderr). Every chart gets `chart`.
 */
export function provideUiChartTesting(chart: ChartHandle = new FakeChart()): Provider {
  return {
    provide: ECHARTS_LOADER,
    useValue: async (): Promise<ChartEngine> => ({ init: () => chart }),
  };
}
