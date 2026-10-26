'use client';

/** 纯 SVG 多序列折线图（无第三方依赖，响应式 + 可打印） */
interface LineSeries {
  name: string;
  color: string;
  values: number[];
}

interface LineChartProps {
  labels: string[];
  series: LineSeries[];
  height?: number;
}

export function formatMoney(n: number): string {
  return `¥${Math.round(n).toLocaleString('zh-CN')}`;
}

export default function LineChart({ labels, series, height = 240 }: LineChartProps) {
  const width = 720;
  const padL = 56;
  const padR = 16;
  const padT = 20;
  const padB = 34;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const allValues = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  const max = Math.max(1, ...allValues);
  const niceMax = max + (max === 0 ? 1 : max * 0.15);
  const min = 0;

  const x = (i: number) => (labels.length <= 1 ? padL + innerW / 2 : padL + (innerW * i) / (labels.length - 1));
  const y = (v: number) => padT + innerH - ((v - min) / (niceMax - min)) * innerH;

  // Y 轴刻度（4 档）
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => (min + (niceMax - min) * f));

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[520px]" role="img" aria-label="趋势图">
        {/* 网格线 + Y 轴刻度 */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={padL}
              y1={y(t)}
              x2={width - padR}
              y2={y(t)}
              stroke="currentColor"
              strokeOpacity={0.12}
              strokeDasharray="4 4"
            />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="currentColor" fillOpacity={0.6} className="tabular-nums">
              {Math.round(t).toLocaleString('zh-CN')}
            </text>
          </g>
        ))}
        {/* X 轴标签 */}
        {labels.map((l, i) => (
          <text key={l} x={x(i)} y={height - 12} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity={0.6} className="tabular-nums">
            {l}
          </text>
        ))}
        {/* 折线 */}
        {series.map((s) => {
          const d = s.values
            .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
            .join(' ');
          return <path key={s.name} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />;
        })}
      </svg>
      {/* 图例 */}
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}