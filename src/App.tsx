import { useCallback, useState } from 'react'
import { VideoUpload } from './components/VideoUpload'
import { VideoPreview } from './components/VideoPreview'
import { ChatPanel } from './components/ChatPanel'
import { ModelSelector } from './components/ModelSelector'
import type { VideoSession } from './types'
import './App.css'

export default function App() {
  const [session, setSession] = useState<VideoSession | null>(null)
  const [activeModel, setActiveModel] = useState<string | null>(null)
  const [inputType, setInputType] = useState<'video' | 'image'>('video')
  const [baseReady, setBaseReady] = useState(false)

  const handleModelReady = useCallback((modelId: string, type: 'video' | 'image') => {
    setActiveModel((prev) => {
      if (prev !== null && prev !== modelId) setSession(null)
      return modelId
    })
    setInputType(type)
  }, [])

  const handleBaseReady = useCallback(() => setBaseReady(true), [])

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">VLM Chat</h1>
        <p className="app__subtitle">Describe and query video scenes with AI</p>
      </header>
      <main className="app__main">
        <ModelSelector onModelReady={handleModelReady} onBaseReady={handleBaseReady} />
        {session ? (
          <VideoPreview session={session} onClear={() => setSession(null)} />
        ) : (
          <VideoUpload onUpload={setSession} inputType={inputType} />
        )}
        <ChatPanel videoId={session?.videoId ?? null} modelReady={!!activeModel} baseReady={baseReady} />
      </main>
    </div>
  )
}
