import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelInfo } from '../types'
import { getSystemInfo, listModels, loadModel, loadBaseModel } from '../services/vlmService'
import './ModelSelector.css'

interface ModelSelectorProps {
  onModelReady: (modelId: string, inputType: 'video' | 'image') => void
}

export function ModelSelector({ onModelReady }: ModelSelectorProps) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [activeModel, setActiveModel] = useState<string | null>(null)
  const [loadingModel, setLoadingModel] = useState<string | null>(null)
  const [vramUsed, setVramUsed] = useState<number | null>(null)
  const [vramTotal, setVramTotal] = useState<number | null>(null)
  const [baseModels, setBaseModels] = useState<{ id: string; label: string }[]>([])
  const [activeBaseModel, setActiveBaseModel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchModels = useCallback(() => {
    setError(null)
    listModels()
      .then(({ models, current, loading, base_model, base_models }) => {
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
      })
      .catch((err) => {
        console.error('listModels failed:', err)
        const msg = err instanceof Error ? err.message : String(err)
        setError(`Could not reach backend: ${msg}`)
      })
  }, [onModelReady])

  useEffect(() => { fetchModels() }, [fetchModels])

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
  }, [loadingModel, onModelReady, models])

  useEffect(() => {
    if (loadingModel) return

    heartbeatRef.current = setInterval(async () => {
      try {
        const info = await getSystemInfo()
        if (info.vram_used_gb !== null) setVramUsed(info.vram_used_gb)
        if (info.vram_total_gb !== null) setVramTotal(info.vram_total_gb)
        if (info.loading && info.current_model) {
          setLoadingModel(info.current_model)
        }
      } catch {}
    }, 3000)

    return () => { if (heartbeatRef.current) clearInterval(heartbeatRef.current) }
  }, [loadingModel])

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
    if (modelId === activeBaseModel) return
    setError(null)
    try {
      await loadBaseModel(modelId)
      setActiveBaseModel(modelId)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="model-selector">
      <div className="model-selector__section">
        <div className="model-selector__header">
          <span className="model-selector__label">Model</span>
          <div className="model-selector__header-right">
            {vramTotal !== null && (
              <span className="model-selector__vram">
                {vramUsed ?? '—'}/{vramTotal}GB
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
      </div>

      {baseModels.length > 0 && (
        <div className="model-selector__section">
          <div className="model-selector__header">
            <span className="model-selector__label">Base (compare)</span>
            <span className="model-selector__base-status">on demand</span>
          </div>
          <div className="model-selector__options">
            {baseModels.map((m) => {
              const isActive = m.id === activeBaseModel
              return (
                <button
                  key={m.id}
                  className={`model-selector__btn model-selector__btn--base${isActive ? ' model-selector__btn--active' : ''}`}
                  onClick={() => handleBaseSelect(m.id)}
                  title={m.id}
                >
                  {m.label}
                </button>
              )
            })}
          </div>
        </div>
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
