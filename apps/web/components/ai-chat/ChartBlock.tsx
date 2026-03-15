"use client";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export interface ChartSpec {
  type: "bar" | "line" | "area" | "pie";
  title?: string;
  data: Record<string, any>[];
  xKey: string;
  yKeys: string[];
  colors?: string[];
  stacked?: boolean;
}

const DEFAULT_COLORS = [
  "#7C3AED",
  "#2563EB",
  "#059669",
  "#D97706",
  "#DC2626",
  "#8B5CF6",
  "#0891B2",
];

export function parseChartSpec(raw: string): ChartSpec | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !["bar", "line", "area", "pie"].includes(parsed.type) ||
      !Array.isArray(parsed.data) ||
      typeof parsed.xKey !== "string" ||
      !Array.isArray(parsed.yKeys) ||
      parsed.yKeys.length === 0
    ) {
      return null;
    }
    return parsed as ChartSpec;
  } catch {
    return null;
  }
}

const TICK_STYLE = { fontSize: 12 };

function BarChartBlock({ spec, colors }: { spec: ChartSpec; colors: string[] }) {
  return (
    <BarChart data={spec.data}>
      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
      <XAxis dataKey={spec.xKey} tick={TICK_STYLE} />
      <YAxis tick={TICK_STYLE} />
      <Tooltip
        contentStyle={{ borderRadius: 8, fontSize: 13, border: "1px solid #e5e7eb" }}
      />
      {spec.yKeys.length > 1 && <Legend />}
      {spec.yKeys.map((key, i) => (
        <Bar
          key={key}
          dataKey={key}
          fill={colors[i % colors.length]}
          stackId={spec.stacked ? "stack" : undefined}
          radius={[4, 4, 0, 0]}
        />
      ))}
    </BarChart>
  );
}

function LineChartBlock({ spec, colors }: { spec: ChartSpec; colors: string[] }) {
  return (
    <LineChart data={spec.data}>
      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
      <XAxis dataKey={spec.xKey} tick={TICK_STYLE} />
      <YAxis tick={TICK_STYLE} />
      <Tooltip
        contentStyle={{ borderRadius: 8, fontSize: 13, border: "1px solid #e5e7eb" }}
      />
      {spec.yKeys.length > 1 && <Legend />}
      {spec.yKeys.map((key, i) => (
        <Line
          key={key}
          type="monotone"
          dataKey={key}
          stroke={colors[i % colors.length]}
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      ))}
    </LineChart>
  );
}

function AreaChartBlock({ spec, colors }: { spec: ChartSpec; colors: string[] }) {
  return (
    <AreaChart data={spec.data}>
      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
      <XAxis dataKey={spec.xKey} tick={TICK_STYLE} />
      <YAxis tick={TICK_STYLE} />
      <Tooltip
        contentStyle={{ borderRadius: 8, fontSize: 13, border: "1px solid #e5e7eb" }}
      />
      {spec.yKeys.length > 1 && <Legend />}
      {spec.yKeys.map((key, i) => (
        <Area
          key={key}
          type="monotone"
          dataKey={key}
          stroke={colors[i % colors.length]}
          fill={colors[i % colors.length]}
          fillOpacity={0.15}
          strokeWidth={2}
          stackId={spec.stacked ? "stack" : undefined}
        />
      ))}
    </AreaChart>
  );
}

function PieChartBlock({ spec, colors }: { spec: ChartSpec; colors: string[] }) {
  const valueKey = spec.yKeys[0];
  const pieData = spec.data.map((d) => ({
    name: d[spec.xKey],
    value: d[valueKey],
  }));

  return (
    <PieChart>
      <Tooltip
        contentStyle={{ borderRadius: 8, fontSize: 13, border: "1px solid #e5e7eb" }}
      />
      <Pie
        data={pieData}
        dataKey="value"
        nameKey="name"
        cx="50%"
        cy="50%"
        outerRadius={100}
        label={({ name, value }) => `${name}: ${value}`}
      >
        {pieData.map((_, i) => (
          <Cell key={i} fill={colors[i % colors.length]} />
        ))}
      </Pie>
      <Legend />
    </PieChart>
  );
}

export default function ChartBlock({ spec }: { spec: ChartSpec }) {
  const colors = spec.colors ?? DEFAULT_COLORS;

  return (
    <div className="rounded-lg border bg-white dark:bg-gray-950 p-4">
      {spec.title && (
        <h4 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-200">{spec.title}</h4>
      )}
      <ResponsiveContainer width="100%" height={300}>
        {spec.type === "bar" ? (
          <BarChartBlock spec={spec} colors={colors} />
        ) : spec.type === "line" ? (
          <LineChartBlock spec={spec} colors={colors} />
        ) : spec.type === "area" ? (
          <AreaChartBlock spec={spec} colors={colors} />
        ) : (
          <PieChartBlock spec={spec} colors={colors} />
        )}
      </ResponsiveContainer>
    </div>
  );
}
