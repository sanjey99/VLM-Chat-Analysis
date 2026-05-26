import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchVideos, fetchAllModels, streamEval,
  type VideoEntry, type LeaderboardEntry, type DetailEntry, type CaseResult,
} from '../services/evalService'
import './EvalPanel.css'

interface EvalCase {
  id: string
  videoId: string
  prompt: string
  reference: string
}

interface EvalResults {
  leaderboard: LeaderboardEntry[]
  details: DetailEntry[]
}

interface Progress {
  text: string
  percent: number
  streaming: string
}

function newCase(videoId: string): EvalCase {
  return { id: crypto.randomUUID(), videoId, prompt: '', reference: '' }
}

function fmt(v: number | null | undefined, decimals = 1): string {
  if (v == null) return '—'
  return v.toFixed(decimals)
}

function bestIdx(entries: LeaderboardEntry[], key: keyof LeaderboardEntry): number {
  let best = -1
  let bestVal = -Infinity
  entries.forEach((e, i) => {
    const v = e[key] as number | null
    if (v != null && v > bestVal) { bestVal = v; best = i }
  })
  return best
}

// ── Sub-components ──────────────────────────────────────────────

function Leaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  const hasRouge = entries.some((e) => e.avg_rouge_l != null)
  const hasBert = entries.some((e) => e.avg_bert_score != null)
  const bestTok = bestIdx(entries, 'avg_tokens_per_sec')
  const bestRouge = bestIdx(entries, 'avg_rouge_l')
  const bestBert = bestIdx(entries, 'avg_bert_score')
  const bestTtft = entries.reduce((best, e, i) => {
    const v = e.avg_ttft_ms
    if (v == null) return best
    return (best === -1 || v < (entries[best].avg_ttft_ms ?? Infinity)) ? i : best
  }, -1)

  return (
    <table className="eval-leaderboard">
      <thead>
        <tr>
          <th>Model</th>
          <th>Avg TTFT</th>
          <th>Avg tok/s</th>
          {hasRouge && <th>ROUGE-L</th>}
          {hasBert && <th>BERTScore</th>}
        </tr>
      </thead>
      <tbody>
        {entries.map((e, i) => (
          <tr key={e.model_id}>
            <td className="eval-leaderboard__name" title={e.model_id}>{e.label}</td>
            <td className={i === bestTtft ? 'eval-leaderboard__best' : ''}>
              {e.avg_ttft_ms != null ? `${e.avg_ttft_ms}ms` : '—'}
            </td>
            <td className={i === bestTok ? 'eval-leaderboard__best' : ''}>
              {fmt(e.avg_tokens_per_sec)}
            </td>
            {hasRouge && (
              <td className={i === bestRouge ? 'eval-leaderboard__best' : ''}>
                {fmt(e.avg_rouge_l, 3)}
              </td>
            )}
            {hasBert && (
              <td className={i === bestBert ? 'eval-leaderboard__best' : ''}>
                {fmt(e.avg_bert_score, 3)}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function CaseDetail({ detail, modelIds, allModels }:
  { detail: DetailEntry; modelIds: string[]; allModels: { id: string; label: string }[] }) {
  const labelOf = (id: string) => allModels.find((m) => m.id === id)?.label ?? id.split('/').pop() ?? id

  return (
    <div className="eval-case-detail">
      <div className="eval-case-detail__header">
        <span className="eval-case-detail__prompt">{detail.prompt}</span>
        {detail.reference && (
          <span className="eval-case-detail__ref">Ref: {detail.reference}</span>
        )}
      </div>
      <div className="eval-case-detail__cols">
        {modelIds.map((mid) => {
          const r: CaseResult | undefined = detail.results[mid]
          return (
            <div key={mid} className="eval-case-detail__col">
              <div className="eval-case-detail__col-name">{labelOf(mid)}</div>
              <div className="eval-case-detail__response">
                {r?.response || <span className="eval-case-detail__empty">No response</span>}
              </div>
              {r?.metrics && (
                <div className="eval-case-detail__metrics">
                  <span>{r.metrics.ttft_ms}ms TTFT</span>
                  <span>{r.metrics.tokens_per_sec} tok/s</span>
                  {r.rouge_l != null && <span>ROUGE-L {r.rouge_l.toFixed(3)}</span>}
                  {r.bert_score != null && <span>BERT {r.bert_score.toFixed(3)}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main panel ──────────────────────────────────────────────────

interface EvalPanelProps {
  onClose: () => void
}

export function EvalPanel({ onClose }: EvalPanelProps) {
  const [videos, setVideos] = useState<VideoEntry[]>([])
  const [allModels, setAllModels] = useState<{ id: string; label: string }[]>([])
  const [cases, setCases] = useState<EvalCase[]>([])
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState<Progress>({ text: '', percent: 0, streaming: '' })
  const [results, setResults] = useState<EvalResults | null>(null)
  const [error, setError] = useState('')
  const [expandedCase, setExpandedCase] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    fetchVideos()
      .then((vs) => {
        setVideos(vs)
        if (vs.length > 0) setCases([newCase(vs[0].video_id)])
      })
      .catch(() => {})
    fetchAllModels()
      .then((ms) => {
        setAllModels(ms)
        if (ms.length > 0) setSelectedModels(new Set([ms[0].id]))
      })
      .catch(() => {})
  }, [])

  const addCase = useCallback(() => {
    setCases((prev) => [...prev, newCase(videos[0]?.video_id ?? '')])
  }, [videos])

  const removeCase = useCallback((id: string) => {
    setCases((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const updateCase = useCallback((id: string, field: keyof EvalCase, value: string) => {
    setCases((prev) => prev.map((c) => c.id === id ? { ...c, [field]: value } : c))
  }, [])

  const toggleModel = useCallback((id: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  async function handleRun() {
    const validCases = cases.filter((c) => c.videoId && c.prompt.trim())
    if (validCases.length === 0) { setError('Add at least one case with a video and prompt.'); return }
    if (selectedModels.size === 0) { setError('Select at least one model.'); return }

    setStatus('running')
    setError('')
    setResults(null)
    setExpandedCase(null)
    const modelIds = [...selectedModels]
    const totalSteps = modelIds.length * validCases.length

    abortRef.current = new AbortController()
    try {
      for await (const event of streamEval(
        validCases.map((c) => ({ video_id: c.videoId, prompt: c.prompt, reference: c.reference || undefined })),
        modelIds,
        abortRef.current.signal,
      )) {
        if ('error' in event) {
          setStatus('error')
          setError(event.error)
          return
        }
        if (event.phase === 'loading_model') {
          setProgress({
            text: `Loading ${event.model.split('/').pop()}… (model ${event.model_idx + 1}/${event.total_models})`,
            percent: Math.round((event.model_idx * validCases.length) / totalSteps * 100),
            streaming: '',
          })
        } else if (event.phase === 'start_case') {
          setProgress((p) => ({
            ...p,
            text: `${event.model.split('/').pop()} · Case ${event.case_idx + 1}/${event.total_cases}`,
            streaming: '',
          }))
        } else if (event.phase === 'token') {
          setProgress((p) => ({ ...p, streaming: p.streaming + event.token }))
        } else if (event.phase === 'case_done') {
          const doneSteps = modelIds.indexOf(event.model) * validCases.length + event.case_idx + 1
          setProgress((p) => ({
            ...p,
            percent: Math.round(doneSteps / totalSteps * 100),
            streaming: '',
          }))
        } else if (event.phase === 'computing_bert_score') {
          setProgress((p) => ({ ...p, text: 'Computing BERTScore…', streaming: '' }))
        } else if (event.phase === 'eval_done') {
          setResults({ leaderboard: event.leaderboard, details: event.details })
          setStatus('done')
          setProgress({ text: 'Complete', percent: 100, streaming: '' })
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setStatus('error')
        setError((err as Error).message)
      } else {
        setStatus('idle')
      }
    }
  }

  function handleStop() {
    abortRef.current?.abort()
    setStatus('idle')
    setProgress({ text: '', percent: 0, streaming: '' })
  }

  const running = status === 'running'

  return (
    <div className="eval-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="eval-panel">
        <div className="eval-panel__header">
          <span className="eval-panel__title">Evaluation Harness</span>
          <button className="eval-panel__close" onClick={onClose}>✕</button>
        </div>

        <div className="eval-panel__body">
          {/* ── Cases ── */}
          <section className="eval-section">
            <div className="eval-section__head">
              <span className="eval-section__label">Test Cases</span>
              <button className="eval-add-btn" onClick={addCase} disabled={running || videos.length === 0}>
                + Add Case
              </button>
            </div>
            {videos.length === 0 && (
              <p className="eval-hint">Upload a video first, then come back to define cases.</p>
            )}
            {cases.map((c) => (
              <div key={c.id} className="eval-case">
                <div className="eval-case__row">
                  <select
                    className="eval-case__video"
                    value={c.videoId}
                    onChange={(e) => updateCase(c.id, 'videoId', e.target.value)}
                    disabled={running}
                  >
                    {videos.map((v) => (
                      <option key={v.video_id} value={v.video_id}>
                        {v.filename} ({v.media_type})
                      </option>
                    ))}
                  </select>
                  <button className="eval-case__remove" onClick={() => removeCase(c.id)} disabled={running}>✕</button>
                </div>
                <input
                  className="eval-case__prompt"
                  type="text"
                  placeholder="Prompt…"
                  value={c.prompt}
                  onChange={(e) => updateCase(c.id, 'prompt', e.target.value)}
                  disabled={running}
                />
                <input
                  className="eval-case__ref"
                  type="text"
                  placeholder="Reference answer (optional — enables ROUGE-L and BERTScore)"
                  value={c.reference}
                  onChange={(e) => updateCase(c.id, 'reference', e.target.value)}
                  disabled={running}
                />
              </div>
            ))}
          </section>

          {/* ── Models ── */}
          <section className="eval-section">
            <div className="eval-section__head">
              <span className="eval-section__label">Models</span>
              <div className="eval-model-actions">
                <button className="eval-text-btn" onClick={() => setSelectedModels(new Set(allModels.map((m) => m.id)))} disabled={running}>All</button>
                <button className="eval-text-btn" onClick={() => setSelectedModels(new Set())} disabled={running}>None</button>
              </div>
            </div>
            <div className="eval-model-grid">
              {allModels.map((m) => (
                <label key={m.id} className={`eval-model-chip${selectedModels.has(m.id) ? ' eval-model-chip--on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selectedModels.has(m.id)}
                    onChange={() => toggleModel(m.id)}
                    disabled={running}
                  />
                  {m.label}
                </label>
              ))}
            </div>
          </section>

          {/* ── Run / Stop ── */}
          <div className="eval-run-row">
            {running ? (
              <button className="eval-run-btn eval-run-btn--stop" onClick={handleStop}>Stop</button>
            ) : (
              <button
                className="eval-run-btn"
                onClick={handleRun}
                disabled={cases.filter((c) => c.videoId && c.prompt.trim()).length === 0 || selectedModels.size === 0}
              >
                Run Evaluation
              </button>
            )}
            {error && <p className="eval-error">{error}</p>}
          </div>

          {/* ── Progress ── */}
          {(running || status === 'done') && (
            <section className="eval-section eval-progress">
              <div className="eval-progress__bar-row">
                <div className="eval-progress__bar">
                  <div className="eval-progress__fill" style={{ width: `${progress.percent}%` }} />
                </div>
                <span className="eval-progress__pct">{progress.percent}%</span>
              </div>
              <span className="eval-progress__text">{progress.text}</span>
              {progress.streaming && (
                <div className="eval-progress__stream">{progress.streaming}</div>
              )}
            </section>
          )}

          {/* ── Results ── */}
          {results && (
            <section className="eval-section">
              <span className="eval-section__label">Leaderboard</span>
              <Leaderboard entries={results.leaderboard} />

              <span className="eval-section__label eval-section__label--mt">Case Details</span>
              {results.details.map((d) => (
                <div key={d.case_idx}>
                  <button
                    className="eval-case-toggle"
                    onClick={() => setExpandedCase(expandedCase === d.case_idx ? null : d.case_idx)}
                  >
                    Case {d.case_idx + 1}: {d.prompt.slice(0, 60)}{d.prompt.length > 60 ? '…' : ''}
                    <span className="eval-case-toggle__chevron">{expandedCase === d.case_idx ? '▲' : '▼'}</span>
                  </button>
                  {expandedCase === d.case_idx && (
                    <CaseDetail detail={d} modelIds={[...selectedModels]} allModels={allModels} />
                  )}
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
