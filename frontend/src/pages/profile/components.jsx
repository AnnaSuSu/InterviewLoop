import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

import { formatShortDate } from "./derive";
import { MODE_META } from "./meta";

// 折叠区。用于把"次要/旧观察"收纳起来,不挤占主区。
export function CollapsibleSection({ title, caption, defaultOpen = false, children, badge }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-dashed border-border/60 bg-black/[0.02] dark:bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
      >
        <div className="flex items-center gap-3">
          <div>
            <div className="text-sm font-semibold">{title}</div>
            {caption && <div className="mt-0.5 text-xs text-dim">{caption}</div>}
          </div>
          {badge}
        </div>
        <ChevronDown
          size={16}
          className={cn("text-dim transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="border-t border-border/40 px-4 py-4">{children}</div>}
    </div>
  );
}

function BehaviorSignalRow({ signal }) {
  const [expanded, setExpanded] = useState(false);
  const examples = signal.examples || [];

  let polarityBadge;
  if (signal.improved) {
    polarityBadge = <Badge variant="outline">已改善</Badge>;
  } else if ((signal.polarity || "negative") === "positive") {
    polarityBadge = <Badge variant="success">优势</Badge>;
  } else {
    polarityBadge = <Badge variant="destructive">短板</Badge>;
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card/80 px-3.5 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-6">
            {signal.description || signal.id}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-dim">
            {polarityBadge}
            <span>出现 {signal.times_seen || 1} 次</span>
            {signal.last_seen && <span>· 最近 {formatShortDate(signal.last_seen)}</span>}
            <span className="font-mono opacity-60">{signal.id}</span>
          </div>
        </div>
        {examples.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 text-xs font-medium text-primary hover:underline"
          >
            {expanded ? "收起证据" : `证据 (${examples.length})`}
          </button>
        )}
      </div>
      {expanded && examples.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
          {examples.map((ex, idx) => (
            <div key={idx} className="text-xs leading-5 text-dim">
              <span className="font-mono opacity-70">{formatShortDate(ex.date)}</span>
              {" — "}
              {ex.snippet}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 按 namespace 分组渲染 behavior_signals。
// namespaces 来自 buildBehaviorSignals().namespaces:
//   [{ key, label, color, negative, positive, improved }, ...]
export function BehaviorSignalList({ namespaces }) {
  const populated = (namespaces || []).filter(
    (ns) =>
      (ns.negative?.length || 0) +
        (ns.positive?.length || 0) +
        (ns.improved?.length || 0) >
      0
  );
  if (populated.length === 0) return null;

  return (
    <div className="space-y-5">
      {populated.map((ns) => {
        const rows = [
          ...(ns.negative || []),
          ...(ns.positive || []),
          ...(ns.improved || []),
        ];
        return (
          <div key={ns.key}>
            <div className={cn("mb-2 text-xs font-semibold uppercase tracking-wide", ns.color)}>
              {ns.label}
            </div>
            <div className="space-y-2">
              {rows.map((signal) => (
                <BehaviorSignalRow key={signal.id} signal={signal} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ScoreChart({ history }) {
  if (!history || history.length < 2) return null;

  const W = 920;
  const H = 260;
  const PAD = { top: 20, right: 22, bottom: 36, left: 38 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const points = history.map((entry, index) => ({
    x: PAD.left + (index / (history.length - 1)) * innerW,
    y: PAD.top + innerH - ((entry.avg_score || 0) / 10) * innerH,
    score: entry.avg_score,
    date: entry.date,
    topic: entry.topic || "综合",
    mode: entry.mode,
  }));

  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${PAD.top + innerH} L${points[0].x},${PAD.top + innerH} Z`;
  const yLabels = [0, 5, 10];
  const xIndices = history.length <= 6
    ? history.map((_, index) => index)
    : [0, Math.floor(history.length / 2), history.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {yLabels.map((value) => {
        const y = PAD.top + innerH - (value / 10) * innerH;
        return (
          <g key={value}>
            <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y + 4} textAnchor="end" fill="var(--muted-foreground)" fontSize={11}>
              {value}
            </text>
          </g>
        );
      })}
      {xIndices.map((index) => (
        <text
          key={index}
          x={points[index].x}
          y={H - 8}
          textAnchor="middle"
          fill="var(--muted-foreground)"
          fontSize={11}
        >
          {history[index].date?.slice(5)}
        </text>
      ))}
      <path d={areaPath} fill="url(#profileChartGradient)" opacity={0.26} />
      <path
        d={linePath}
        fill="none"
        stroke="var(--ai-glow)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((point, index) => (
        <g key={index}>
          <circle
            cx={point.x}
            cy={point.y}
            r={4.5}
            fill={(MODE_META[point.mode] || MODE_META.topic_drill).color}
            stroke="var(--card)"
            strokeWidth={2}
          />
          <title>
            {`${point.date} ${(MODE_META[point.mode] || MODE_META.topic_drill).label}${point.topic ? ` · ${point.topic}` : ""}: ${point.score}/10`}
          </title>
        </g>
      ))}
      <defs>
        <linearGradient id="profileChartGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ai-glow)" />
          <stop offset="100%" stopColor="var(--ai-glow)" stopOpacity={0} />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function SectionHeader({ icon, title, caption, action }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </div>
        <div>
          <div className="text-base font-semibold">{title}</div>
          {caption && <div className="mt-0.5 text-sm text-dim">{caption}</div>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function TopicPriorityCard({ item, onSelect, label }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.topic)}
      className="group w-full rounded-xl border border-primary/15 bg-[linear-gradient(180deg,rgba(245,158,11,0.04),transparent)] px-3.5 py-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/[0.04] dark:bg-[linear-gradient(180deg,rgba(245,158,11,0.06),transparent)]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {label && (
            <span className="inline-flex shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-medium text-primary">
              {label}
            </span>
          )}
          <span className="truncate text-sm font-semibold">{item.topic}</span>
          {item.weakCount > 0 && (
            <Badge variant="destructive" className="shrink-0 px-1.5 py-0 text-[10px]">待补 {item.weakCount}</Badge>
          )}
          {item.strongCount > 0 && (
            <Badge variant="success" className="shrink-0 px-1.5 py-0 text-[10px]">强项 {item.strongCount}</Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* 掌握度 0 视作未评估:后端在无有效回答时给 0,展示成分数会像不及格 */}
          {item.score ? (
            <span className="text-sm font-semibold text-primary">{item.score}/100</span>
          ) : (
            <span className="text-xs font-medium text-dim">待评估</span>
          )}
          <ChevronRight size={14} className="text-dim transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.12]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-orange"
          style={{ width: `${item.score || 0}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-dim">
        <span className="line-clamp-1 flex-1">
          {item.topWeakness || item.note || "已有训练记录"}
        </span>
        {item.lastSignal && (
          <span className="shrink-0 opacity-70">{formatShortDate(item.lastSignal)}</span>
        )}
      </div>
    </button>
  );
}

export function CrossBlockerList({ items }) {
  return (
    <div className="space-y-3">
      {items.length > 0 ? items.map((item, index) => (
        <div
          key={`${item.point}-${index}`}
          className="rounded-2xl border border-border/80 bg-black/[0.02] p-4 dark:bg-white/[0.02]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="text-sm font-semibold leading-6">{item.point}</div>
              <div className="mt-2 text-xs leading-5 text-dim">{item.reason}</div>
            </div>
            {item.topic && <Badge variant="outline">{item.topic}</Badge>}
          </div>
        </div>
      )) : (
        <div className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-sm text-dim">
          目前没有明显的跨领域阻塞项。
        </div>
      )}
    </div>
  );
}

// 表现轴的 namespace 卡。dim 来自 buildBehaviorSignals().namespaces,
// 字段: { key, label, color, bg, negative: [...], positive: [...], improved: [...] }
// 每个数组里的元素是 behavior_signal: { id, description, times_seen, last_seen, examples, ... }
export function PerformanceDimCard({ dim }) {
  const negative = dim.negative || [];
  const positive = dim.positive || [];
  const improved = dim.improved || [];
  const hasAny = negative.length + positive.length + improved.length > 0;
  if (!hasAny) return null;

  const featured = negative[0] || positive[0] || improved[0];

  return (
    <div className={cn("rounded-xl border border-border/60 p-3.5", dim.bg)}>
      <div className={cn("text-xs font-semibold", dim.color)}>{dim.label}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {negative.length > 0 && <Badge variant="destructive">{negative.length}</Badge>}
        {positive.length > 0 && <Badge variant="success">+{positive.length}</Badge>}
        {improved.length > 0 && <Badge variant="outline">改善 {improved.length}</Badge>}
      </div>
      {featured && (
        <div className="mt-2.5 text-xs leading-5 text-dim line-clamp-2">
          {featured.description || featured.id}
        </div>
      )}
    </div>
  );
}

export function PatternColumn({ title, color, items }) {
  if (items.length === 0) return null;

  return (
    <div>
      <div className={cn("text-xs font-semibold uppercase tracking-wide mb-2", color)}>{title}</div>
      <ul className="space-y-1.5">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex items-start gap-2 text-sm leading-6 text-dim">
            <span className={cn("mt-2 h-1.5 w-1.5 rounded-full shrink-0", color.replace("text-", "bg-"))} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HabitTagList({ items }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 5);
  const hasMore = items.length > 5;

  if (items.length === 0) {
    return <div className="text-sm text-dim">还没有记录到稳定的表达习惯。</div>;
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {visible.map((item, index) => (
          <Badge key={`${item}-${index}`} variant="secondary" className="rounded-full px-3 py-1 text-xs">
            {item}
          </Badge>
        ))}
      </div>
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 text-left text-[13px] text-primary hover:underline"
        >
          {expanded ? "收起" : `展开更多 (+${items.length - 5})`}
        </button>
      )}
    </div>
  );
}
