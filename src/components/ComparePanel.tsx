import type { CompareMetrics } from '../types'
import './ComparePanel.css'

export interface ColState {
  model: string
  response: string
  metrics: CompareMetrics | null
  streaming: boolean
  loadingModel?: boolean
}

interface ComparePanelProps {
  leftCol: ColState
  rightCol: ColState
  rougeL: number | null
  status: 'idle' | 'running' | 'done' | 'error'
  error?: string
  vramSamples?: Array<{ t: number; gb: number }>
}

function shortName(modelId: string): string {
  return modelId.split('/').pop() ?? modelId
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="compare-metric">
      <span className="compare-metric__value">{value}</span>
      <span className="compare-metric__label">{label}</span>
    </div>
  )
}

function ModelCol({ col }: { col: ColState }) {
  return (
    <div className="compare-col">
      <div className="compare-col__header">
        <span className="compare-col__name" title={col.model}>{shortName(col.model)}</span>
        {col.streaming && <span className="compare-col__dot" />}
      </div>
      <div className="compare-col__response">
        {col.response
          ? col.response
          : <span className="compare-col__waiting">
              {col.loadingModel ? 'Loading model…' : col.streaming ? 'Generating…' : 'Waiting…'}
            </span>}
      </div>
      {col.metrics && (
        <div className="compare-col__metrics">
          <MetricCard label="First token" value={`${col.metrics.ttft_ms}ms`} />
          <MetricCard label="Tok/s" value={String(col.metrics.tokens_per_sec)} />
          <MetricCard label="Total" value={`${(col.metrics.total_ms / 1000).toFixed(1)}s`} />
          <MetricCard label="Tokens" value={String(col.metrics.token_count)} />
        </div>
      )}
    </div>
  )
}

function VramChart({ samples }: { samples: Array<{ t: number; gb: number }> }) {
  if (samples.length < 2) return null
  const W = 300
  const H = 36
  const maxGb = Math.max(...samples.map((s) => s.gb), 0.1)
  const maxT = Math.max(samples[samples.length - 1].t, 1)
  const pts = samples
    .map((s) => `${(s.t / maxT) * W},${H - (s.gb / maxGb) * H}`)
    .join(' ')
  const current = samples[samples.length - 1].gb
  return (
    <div className="compare-vram">
      <span className="compare-vram__label">VRAM</span>
      <svg viewBox={`0 0 ${W} ${H}`} className="compare-vram__svg" preserveAspectRatio="none">
        <polyline points={pts} className="compare-vram__line" fill="none" strokeWidth="1.5" />
      </svg>
      <span className="compare-vram__current">{current} GB</span>
    </div>
  )
}

function rougeBadge(score: number): string {
  if (score > 0.7) return 'High overlap — models largely agree'
  if (score > 0.4) return 'Moderate overlap — some differences'
  return 'Low overlap — specialist diverges from base'
}

export function ComparePanel({ leftCol, rightCol, rougeL, status, error, vramSamples }: ComparePanelProps) {
  if (status === 'idle') return null

  return (
    <div className="compare-panel">
      {error && <p className="compare-panel__error">{error}</p>}
      <div className="compare-panel__cols">
        <ModelCol col={leftCol} />
        <div className="compare-panel__divider" />
        <ModelCol col={rightCol} />
      </div>
      {vramSamples && vramSamples.length >= 2 && <VramChart samples={vramSamples} />}
      {rougeL !== null && (
        <div className="compare-panel__rouge">
          <span className="compare-panel__rouge-score">{(rougeL * 100).toFixed(1)}%</span>
          <span className="compare-panel__rouge-label">ROUGE-L</span>
          <span className="compare-panel__rouge-hint">{rougeBadge(rougeL)}</span>
        </div>
      )}
    </div>
  )
}
