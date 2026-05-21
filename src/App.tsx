import { useState } from 'react'
import { VideoUpload } from './components/VideoUpload'
import { VideoPreview } from './components/VideoPreview'
import { ChatPanel } from './components/ChatPanel'
import type { VideoSession } from './types'
import './App.css'

export default function App() {
  const [session, setSession] = useState<VideoSession | null>(null)

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">VLM Chat</h1>
        <p className="app__subtitle">Describe and query video scenes with AI</p>
      </header>
      <main className="app__main">
        {session ? (
          <VideoPreview session={session} onClear={() => setSession(null)} />
        ) : (
          <VideoUpload onUpload={setSession} />
        )}
        <ChatPanel videoId={session?.videoId ?? null} />
      </main>
    </div>
  )
}
