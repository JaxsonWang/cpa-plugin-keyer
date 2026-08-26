import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  AriaComponent,
  AxisPointerComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
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
  LegendComponent,
  LineChart,
  PieChart,
  TooltipComponent,
]);

export { init } from "echarts/core";
export type { ECharts, EChartsCoreOption } from "echarts/core";
