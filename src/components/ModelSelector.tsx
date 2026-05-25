import { useEffect, useRef, useState } from 'react'
import type { ModelInfo } from '../types'
import { getSystemInfo, listModels, loadModel } from '../services/vlmService'
import './ModelSelector.css'

interface ModelSelectorProps {
  onModelReady: (modelId: string) => void
}

export function ModelSelector({ onModelReady }: ModelSelectorProps) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [activeModel, setActiveModel] = useState<string | null>(null)
  const [loadingModel, setLoadingModel] = useState<string | null>(null)
  const [vramUsed, setVramUsed] = useState<number | null>(null)
  const [vramTotal, setVramTotal] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    listModels()
      .then(({ models, current, loading }) => {
        setModels(models)
        setActiveModel(current)
        if (loading && current) setLoadingModel(current)
      })
      .catch(() => {})
  }, [])

  // Poll system/info while a model is loading
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
          onModelReady(info.current_model)
          clearInterval(pollRef.current!)
        }
      } catch {}
    }, 1500)

    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [loadingModel, onModelReady])

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

  return (
    <div className="model-selector">
      <div className="model-selector__header">
        <span className="model-selector__label">Model</span>
        {vramTotal !== null && (
          <span className="model-selector__vram">
            VRAM {vramUsed ?? '—'} / {vramTotal} GB
          </span>
        )}
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
      {error && <p className="model-selector__error">{error}</p>}
    </div>
  )
}
