'use client';

/** 货币金额格式化（千分位） */
export function formatMoney(n: number | string | null | undefined): string {
  const num = typeof n === 'string' ? Number(n) : n ?? 0;
  if (Number.isNaN(num)) return '-';
  return num.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

/** 纯 SVG 横向柱状图（无依赖，响应式 + 可打印） */
export interface BarDatum {
  key: string;
  label: string;
  amount: number;
  order_count?: number;
}

interface BarChartProps {
  data: BarDatum[];
  height?: number;
  /** 顶部数量列说明 */
  footerEnabled?: boolean;
}

export default function BarChart({ data, height = 260, footerEnabled = true }: BarChartProps) {
  const width = 720;
  const rowH = 34;
  const barH = 18;
  const padL = 132;
  const padR = 70;
  const padT = 10;
  const barAreaW = width - padL - padR;
  const list = data.slice(0, 24);
  const h = padT + list.length * rowH;

  const max = Math.max(1, ...list.map((d) => d.amount));
  const barWidth = (amount: number) => (amount / max) * barAreaW;

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${Math.max(height, h)}`} className="w-full min-w-[560px]" role="img" aria-label="金额分布">
        {list.map((d, i) => {
          const y = padT + i * rowH;
          return (
            <g key={d.key}>
              <text x={padL - 8} y={y + barH / 2 + 4} textAnchor="end" fontSize="12" fill="currentColor" fillOpacity={0.8}>
                {d.label}
              </text>
              <rect x={padL} y={y} width={Math.max(2, barWidth(d.amount))} height={barH} rx={3} fill="#c2410c" fillOpacity={0.85} />
              <text x={padL + barWidth(d.amount) + 6} y={y + barH / 2 + 4} fontSize="11" fill="currentColor" className="tabular-nums">
                {Math.round(d.amount).toLocaleString('zh-CN')}
                {footerEnabled && d.order_count ? ` · ${d.order_count}单` : ''}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}