import { LineChart, ScatterChart } from 'echarts/charts';
import {
  AxisPointerComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { init, use } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import type { ChartEngine, ChartHandle } from './echarts-loader';

// Static named imports, so the bundler keeps only these parts of ECharts. Only echarts-loader.ts
// reaches this file, and only through import().
use([
  LineChart,
  ScatterChart,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  VisualMapComponent,
  AxisPointerComponent,
  TooltipComponent,
  SVGRenderer,
]);

export const engine: ChartEngine = {
  init: (host) => init(host, undefined, { renderer: 'svg' }) as unknown as ChartHandle,
};
