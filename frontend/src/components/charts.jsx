import { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  ArcElement, BarElement, CategoryScale, LinearScale,
  PointElement, LineElement, Tooltip, Legend, Filler, Title,
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import { formatBDT, formatBDTAxis, formatNumber } from '../utils/format.js';
import { EmptyState } from './ui.jsx';

/*
 * One Chart.js setup + one responsive chart shell shared by every analytics
 * section, so legends, tooltips, axes, animation and colours stay consistent.
 */
ChartJS.register(
  ArcElement, BarElement, CategoryScale, LinearScale,
  PointElement, LineElement, Tooltip, Legend, Filler, Title,
);

ChartJS.defaults.font.family = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
ChartJS.defaults.font.size = 12;
ChartJS.defaults.color = '#64746b';
ChartJS.defaults.animation.duration = 400; // subtle, professional

/** Consistent palette — green/teal/blue/amber/red accents on white cards. */
export const PALETTE = {
  green: '#0F4C3A',
  teal: '#0d9488',
  blue: '#2563eb',
  sky: '#0ea5e9',
  amber: '#f59e0b',
  red: '#dc2626',
  violet: '#7c3aed',
  slate: '#94a3b8',
};
export const DONUT_COLORS = [
  PALETTE.green, PALETTE.teal, PALETTE.blue, PALETTE.amber,
  PALETTE.violet, PALETTE.sky, PALETTE.red, PALETTE.slate,
];

/** Statuses keep the same colour wherever they appear. */
export const STATUS_COLORS = {
  success: PALETTE.green, approved: PALETTE.green, published: PALETTE.green,
  open: PALETTE.teal, resolved: PALETTE.green, in_progress: PALETTE.sky,
  pending: PALETTE.amber, closed: PALETTE.slate, cancelled: PALETTE.red,
  rejected: PALETTE.red, failed: PALETTE.red, refunded: PALETTE.violet,
  draft: PALETTE.slate, completed: PALETTE.blue,
};
export const URGENCY_COLORS = {
  emergency: PALETTE.red, high: PALETTE.amber, medium: PALETTE.sky, low: PALETTE.slate,
};

function useIsDesktop() {
  const [big, setBig] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 640);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const on = () => setBig(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return big;
}

const isEmptySeries = (labels, datasets) =>
  !labels.length || datasets.every((d) => (d.data || []).every((v) => !Number(v)));

/** Value axis (counts / ৳): zero-based, light grid, formatted ticks. */
function valueAxisScale(stacked, axisMoney, currency) {
  return {
    stacked,
    beginAtZero: true,
    grid: { color: 'rgba(100,116,139,0.16)' },
    border: { display: false },
    ticks: { font: { size: 11 }, callback: axisMoney, precision: currency ? 0 : undefined },
  };
}

/** Category axis (months / statuses): no grid, long labels wrapped or clipped. */
function categoryAxisScale(stacked, rotate = false) {
  return {
    stacked,
    grid: { display: false },
    border: { display: false },
    ticks: {
      autoSkip: rotate ? false : true,
      maxRotation: rotate ? 0 : 42,
      minRotation: 0,
      font: { size: 11 },
      callback(value) {
        const label = this.getLabelForValue(value);
        if (typeof label !== 'string' || label.length <= 14) return label;
        return rotate ? `${label.slice(0, 13)}…` : label;
      },
    },
  };
}

/**
 * Responsive chart card: title, subtitle, legend, tooltips and axes come from
 * here — callers only pass labels + datasets.
 *
 * type: 'bar' | 'line' | 'doughnut' | 'horizontalBar'
 * currency: format money values as ৳ everywhere (ticks + tooltips)
 */
export function ChartBox({
  type = 'bar',
  title,
  subtitle,
  labels = [],
  datasets = [],
  height = 280,
  currency = false,
  stacked = false,
  percent = false,
  emptyMessage = 'No records for the selected period.',
  note,
  options: extraOptions = {},
}) {
  const isDesktop = useIsDesktop();
  const isDoughnut = type === 'doughnut';
  const horizontal = type === 'horizontalBar';
  const empty = isEmptySeries(labels, datasets);

  const money = (v) => (currency ? formatBDT(v) : formatNumber(v));
  const axisMoney = (v) => (currency ? formatBDTAxis(v) : formatNumber(v));

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    layout: { padding: { top: 2, left: 2, right: 6, bottom: 0 } },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: isDoughnut ? (isDesktop ? 'right' : 'bottom') : 'bottom',
        align: 'center',
        labels: { boxWidth: 11, boxHeight: 11, usePointStyle: true, padding: 14, font: { size: 11.5 } },
      },
      title: { display: false },
      tooltip: {
        backgroundColor: '#24332d',
        padding: 10,
        cornerRadius: 8,
        titleFont: { size: 12, weight: '600' },
        bodyFont: { size: 12 },
        callbacks: {
          label(ctx) {
            const raw = isDoughnut ? ctx.parsed : (ctx.parsed?.y ?? ctx.parsed?.x ?? ctx.parsed);
            const name = ctx.dataset?.label ? `${ctx.dataset.label}: ` : (ctx.label ? `${ctx.label}: ` : '');
            let text = `${name}${money(raw)}`;
            if (percent && isDoughnut) {
              const total = (ctx.dataset?.data || []).reduce((a, b) => a + Number(b), 0);
              const share = total ? Math.round((Number(raw) / total) * 1000) / 10 : 0;
              text += ` (${share}%)`;
            }
            return text;
          },
        },
      },
    },
    scales: isDoughnut
      ? {}
      : {
          // The CATEGORY axis shows the labels, the VALUE axis shows money/counts.
          // A horizontal bar flips them, so build each side accordingly.
          x: horizontal ? valueAxisScale(stacked, axisMoney, currency) : categoryAxisScale(stacked),
          y: horizontal ? categoryAxisScale(stacked, true) : valueAxisScale(stacked, axisMoney, currency),
        },
    ...extraOptions,
  };

  const Chart = type === 'line' ? Line : isDoughnut ? Doughnut : Bar;
  const chartData = {
    labels,
    datasets: datasets.map((d) => ({
      borderRadius: type === 'line' || isDoughnut ? 0 : 5,
      borderSkipped: false,
      maxBarThickness: 46,
      ...d,
    })),
  };

  return (
    <div className="min-w-0 max-w-full rounded-xl border border-line bg-white p-5 shadow-sm">
      <div className="mb-3 min-w-0">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-ink-soft">{subtitle}</p>}
      </div>

      {empty ? (
        <div className="flex items-center justify-center" style={{ minHeight: Math.min(height, 200) }}>
          <div className="w-full">
            <EmptyState title={emptyMessage} hint="Adjust the filters or refresh to load new records." />
          </div>
        </div>
      ) : (
        <div style={{ height, position: 'relative', minWidth: 0, maxWidth: '100%' }} aria-label={title} role="img">
          <Chart type={isDoughnut ? 'doughnut' : type === 'line' ? 'line' : 'bar'} data={chartData} options={options} />
        </div>
      )}

      {note && <p className="mt-3 text-[11px] leading-relaxed text-ink-soft">{note}</p>}
    </div>
  );
}
