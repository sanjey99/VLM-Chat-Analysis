import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelInfo } from '../types'
import { getSystemInfo, listModels, loadModel, loadBaseModel } from '../services/vlmService'
import './ModelSelector.css'

interface ModelSelectorProps {
  onModelReady: (modelId: string, inputType: 'video' | 'image') => void
  onBaseReady: () => void
  onBaseLoading: () => void
}

export function ModelSelector({ onModelReady, onBaseReady, onBaseLoading }: ModelSelectorProps) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [activeModel, setActiveModel] = useState<string | null>(null)
  const [loadingModel, setLoadingModel] = useState<string | null>(null)
  const [vramUsed, setVramUsed] = useState<number | null>(null)
  const [vramTotal, setVramTotal] = useState<number | null>(null)
  const [baseModels, setBaseModels] = useState<{ id: string; label: string }[]>([])
  const [activeBaseModel, setActiveBaseModel] = useState<string | null>(null)
  const [loadingBaseModel, setLoadingBaseModel] = useState<string | null>(null)
  const [baseStatus, setBaseStatus] = useState<'loading' | 'ready' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const baseRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchModels = useCallback(() => {
    setError(null)
    listModels()
      .then(({ models, current, loading, base_ready, base_loading, base_model, base_models }) => {
        setModels(models)
        setActiveModel(current)
        setBaseModels(base_models)
        if (base_model) setActiveBaseModel(base_model)
        if (loading) {
          setLoadingModel(current ?? '__startup__')
        } else if (current) {
          const loaded = models.find((m) => m.id === current)
          onModelReady(current, loaded?.inputType ?? 'video')
        }
        if (base_ready) {
          setBaseStatus('ready')
          onBaseReady()
        } else if (base_loading || loading) {
          setBaseStatus('loading')
        }
      })
      .catch((err) => {
        console.error('listModels failed:', err)
        const msg = err instanceof Error ? err.message : String(err)
        setError(`Could not reach backend: ${msg}`)
      })
  }, [onBaseReady])

  useEffect(() => { fetchModels() }, [fetchModels])

  // Poll system/info while an active model is loading
  useEffect(() => {
    if (!loadingModel) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }

    pollRef.current = setInterval(async () => {
      try {
        const info = await getSystemInfo()
        if (info.vram_used_gb !== null) setVramUsed(info.vram_used_gb)
        if (info.vram_total_gb !== null) setVramTotal(info.vram_total_gb)
        if (!info.loading && info.ready && info.current_model) {
          setActiveModel(info.current_model)
          setLoadingModel(null)
          const loaded = models.find((m) => m.id === info.current_model)
          onModelReady(info.current_model, loaded?.inputType ?? 'video')
          clearInterval(pollRef.current!)
        }
      } catch {}
    }, 1500)

    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [loadingModel, onModelReady])

  // Poll for base model readiness
  useEffect(() => {
    if (baseStatus === 'ready') return

    baseRef.current = setInterval(async () => {
      try {
        const info = await getSystemInfo()
        if (info.vram_used_gb !== null) setVramUsed(info.vram_used_gb)
        if (info.vram_total_gb !== null) setVramTotal(info.vram_total_gb)
        if (info.base_ready) {
          setBaseStatus('ready')
          if (info.base_model) setActiveBaseModel(info.base_model)
          setLoadingBaseModel(null)
          onBaseReady()
          clearInterval(baseRef.current!)
        } else if (info.base_loading) {
          setBaseStatus('loading')
        }
      } catch {}
    }, 2000)

    return () => { if (baseRef.current) clearInterval(baseRef.current) }
  }, [baseStatus, onBaseReady])

  async function handleSelect(modelId: string) {
    if (modelId === activeModel || loadingModel) return
    setError(null)
    setLoadingModel(modelId)
    try {
      await loadModel(modelId)
    } catch (err) {
      setError((err as Error).message)
      setLoadingModel(null)
    }
  }

  async function handleBaseSelect(modelId: string) {
    if (modelId === activeBaseModel || loadingBaseModel) return
    setError(null)
    setLoadingBaseModel(modelId)
    setBaseStatus('loading')
    onBaseLoading()
    try {
      await loadBaseModel(modelId)
    } catch (err) {
      setError((err as Error).message)
      setLoadingBaseModel(null)
      // old base model still resident — restore ready state
      setBaseStatus('ready')
      onBaseReady()
    }
  }

  return (
    <div className="model-selector">
      <div className="model-selector__header">
        <span className="model-selector__label">Model</span>
        <div className="model-selector__header-right">
          {vramTotal !== null && (
            <span className="model-selector__vram">
              VRAM {vramUsed ?? '—'} / {vramTotal} GB
            </span>
          )}
        </div>
      </div>
      <div className="model-selector__options">
        {models.map((m) => {
          const isActive = m.id === activeModel && !loadingModel
          const isLoading = m.id === loadingModel
          return (
            <button
              key={m.id}
              className={`model-selector__btn${isActive ? ' model-selector__btn--active' : ''}${isLoading ? ' model-selector__btn--loading' : ''}`}
              onClick={() => handleSelect(m.id)}
              disabled={!!loadingModel}
              title={m.id}
            >
              {isLoading && <span className="model-selector__spinner" />}
              {m.label}
            </button>
          )
        })}
      </div>

      {baseModels.length > 0 && (
        <>
          <div className="model-selector__header">
            <span className="model-selector__label">Base model (compare)</span>
            <div className="model-selector__header-right">
              {baseStatus === 'loading' && (
                <span className="model-selector__base-status">Loading…</span>
              )}
              {baseStatus === 'ready' && (
                <span className="model-selector__base-status model-selector__base-status--ready">Ready</span>
              )}
            </div>
          </div>
          <div className="model-selector__options">
            {baseModels.map((m) => {
              const isActive = m.id === activeBaseModel && !loadingBaseModel
              const isLoading = m.id === loadingBaseModel
              return (
                <button
                  key={m.id}
                  className={`model-selector__btn model-selector__btn--base${isActive ? ' model-selector__btn--active' : ''}${isLoading ? ' model-selector__btn--loading' : ''}`}
                  onClick={() => handleBaseSelect(m.id)}
                  disabled={!!loadingBaseModel}
                  title={m.id}
                >
                  {isLoading && <span className="model-selector__spinner" />}
                  {m.label}
                </button>
              )
            })}
          </div>
        </>
      )}

      {error && (
        <div className="model-selector__error-row">
          <p className="model-selector__error">{error}</p>
          <button className="model-selector__retry" onClick={fetchModels}>Retry</button>
        </div>
      )}
    </div>
  )
}
