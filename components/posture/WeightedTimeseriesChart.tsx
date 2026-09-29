"use client";

import { useState } from "react";

interface DataPoint {
  date: string;
  weightedScore: number;
  countCritical: number;
  countHigh: number;
  countMedium: number;
  countLow: number;
}

interface WeightedTimeseriesChartProps {
  data: DataPoint[];
  title?: string;
  /** Chart width in px. Default: 600 */
  width?: number;
  /** Chart height in px. Default: 200 */
  height?: number;
}

const PADDING = { top: 16, right: 16, bottom: 32, left: 48 };

/**
 * Hand-rolled SVG line chart showing severity-weighted security posture over time.
 *
 * Renders a path connecting data points plus interactive tooltips on hover.
 * Empty state shown when no data is provided.
 */
export function WeightedTimeseriesChart({
  data,
  title,
  width = 600,
  height = 200,
}: WeightedTimeseriesChartProps) {
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    point: DataPoint;
  } | null>(null);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-sm text-fg/40">
        No data available
      </div>
    );
  }

  const chartWidth = width - PADDING.left - PADDING.right;
  const chartHeight = height - PADDING.top - PADDING.bottom;

  const maxScore = Math.max(...data.map((d) => d.weightedScore), 1);
  const minScore = Math.min(...data.map((d) => d.weightedScore), 0);
  const scoreRange = maxScore - minScore || 1;

  function xPos(i: number): number {
    return PADDING.left + (i / Math.max(data.length - 1, 1)) * chartWidth;
  }

  function yPos(score: number): number {
    return PADDING.top + (1 - (score - minScore) / scoreRange) * chartHeight;
  }

  // Build the SVG path
  const pathD = data
    .map((point, i) => `${i === 0 ? "M" : "L"} ${xPos(i)} ${yPos(point.weightedScore)}`)
    .join(" ");

  // X-axis labels — show up to 5 evenly spaced dates
  const labelIndices: number[] = [];
  if (data.length <= 5) {
    data.forEach((_, i) => labelIndices.push(i));
  } else {
    const step = Math.floor((data.length - 1) / 4);
    for (let i = 0; i <= 4; i++) {
      labelIndices.push(Math.min(i * step, data.length - 1));
    }
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  return (
    <div className="relative">
      {title && (
        <h3 className="text-sm font-medium text-fg/70 mb-2">{title}</h3>
      )}
      <svg
        width={width}
        height={height}
        aria-label="weighted timeseries chart"
        className="w-full"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Y-axis grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = PADDING.top + fraction * chartHeight;
          const score = Math.round(maxScore - fraction * scoreRange);
          return (
            <g key={fraction}>
              <line
                x1={PADDING.left}
                y1={y}
                x2={PADDING.left + chartWidth}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.08}
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 6}
                y={y + 4}
                textAnchor="end"
                fontSize={9}
                fill="currentColor"
                fillOpacity={0.4}
              >
                {score}
              </text>
            </g>
          );
        })}

        {/* Chart line */}
        <path
          d={pathD}
          fill="none"
          stroke="var(--color-accent, #6366f1)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Area fill */}
        <path
          d={`${pathD} L ${xPos(data.length - 1)} ${PADDING.top + chartHeight} L ${xPos(0)} ${PADDING.top + chartHeight} Z`}
          fill="var(--color-accent, #6366f1)"
          fillOpacity={0.07}
        />

        {/* Data point circles + hover targets */}
        {data.map((point, i) => (
          <circle
            key={i}
            cx={xPos(i)}
            cy={yPos(point.weightedScore)}
            r={4}
            fill="var(--color-accent, #6366f1)"
            stroke="var(--color-bg, white)"
            strokeWidth={2}
            className="cursor-pointer"
            onMouseEnter={(e) =>
              setTooltip({
                x: xPos(i),
                y: yPos(point.weightedScore),
                point,
              })
            }
          />
        ))}

        {/* X-axis labels */}
        {labelIndices.map((i) => (
          <text
            key={i}
            x={xPos(i)}
            y={PADDING.top + chartHeight + 20}
            textAnchor="middle"
            fontSize={9}
            fill="currentColor"
            fillOpacity={0.4}
          >
            {formatDate(data[i].date)}
          </text>
        ))}

        {/* Tooltip */}
        {tooltip && (
          <g role="tooltip" aria-live="polite">
            <rect
              x={tooltip.x + 8}
              y={tooltip.y - 36}
              width={110}
              height={48}
              rx={4}
              fill="var(--color-surface, #fff)"
              stroke="currentColor"
              strokeOpacity={0.15}
              strokeWidth={1}
              filter="drop-shadow(0 2px 4px rgba(0,0,0,.12))"
            />
            <text
              x={tooltip.x + 13}
              y={tooltip.y - 20}
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.7}
            >
              {tooltip.point.date}
            </text>
            <text
              x={tooltip.x + 13}
              y={tooltip.y - 6}
              fontSize={11}
              fontWeight="600"
              fill="var(--color-accent, #6366f1)"
            >
              Score: {tooltip.point.weightedScore}
            </text>
            <text
              x={tooltip.x + 13}
              y={tooltip.y + 6}
              fontSize={9}
              fill="currentColor"
              fillOpacity={0.5}
            >
              C:{tooltip.point.countCritical} H:{tooltip.point.countHigh} M:
              {tooltip.point.countMedium}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
