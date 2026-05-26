import type { Message } from '../types'
import './MetricsChart.css'

interface MetricsChartProps {
  messages: Message[]
}

const BAR_W = 18
const GAP = 5
const H = 48
const LABEL_H = 12

export function MetricsChart({ messages }: MetricsChartProps) {
  const points = messages
    .filter((m) => m.role === 'assistant' && m.metrics)
    .map((m, i) => ({ i: i + 1, m: m.metrics! }))

  if (points.length < 1) return null

  const maxTokps = Math.max(...points.map((p) => p.m.tokens_per_sec), 1)
  const svgW = Math.max(points.length * (BAR_W + GAP) - GAP, 120)

  return (
    <div className="metrics-chart">
      <div className="metrics-chart__header">
        <span className="metrics-chart__title">tok/s per response</span>
        <span className="metrics-chart__peak">{maxTokps} peak</span>
      </div>
      <div className="metrics-chart__scroll">
        <svg width={svgW} height={H + LABEL_H} className="metrics-chart__svg">
          {points.map((p, idx) => {
            const x = idx * (BAR_W + GAP)
            const barH = Math.max((p.m.tokens_per_sec / maxTokps) * H, 2)
            const y = H - barH
            return (
              <g key={p.i}>
                <rect x={x} y={y} width={BAR_W} height={barH} rx={2} className="metrics-chart__bar">
                  <title>
                    Response {p.i}: {p.m.tokens_per_sec} tok/s · {(p.m.total_ms / 1000).toFixed(1)}s · TTFT {p.m.ttft_ms}ms · {p.m.token_count} tokens
                    {p.m.vram_used_gb != null ? ` · ${p.m.vram_used_gb} GB GPU` : ''}
                  </title>
                </rect>
                <text x={x + BAR_W / 2} y={H + LABEL_H - 1} className="metrics-chart__tick" textAnchor="middle">
                  {p.i}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
