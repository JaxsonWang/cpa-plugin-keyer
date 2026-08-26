import { BarChart, HeatmapChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import {
  AriaComponent,
  AxisPointerComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

use([
  AriaComponent,
  AxisPointerComponent,
  BarChart,
  CanvasRenderer,
  DatasetComponent,
  GridComponent,
  HeatmapChart,
  LegendComponent,
  LineChart,
  PieChart,
  ScatterChart,
  TooltipComponent,
  VisualMapComponent,
]);

export { init } from "echarts/core";
export type { ECharts, EChartsCoreOption } from "echarts/core";
