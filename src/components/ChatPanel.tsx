import { useEffect, useRef, useState } from 'react'
import type { Message } from '../types'
import { MessageBubble } from './MessageBubble'
import { runAgentLoop } from '../services/agentLoop'
import './ChatPanel.css'

interface ChatPanelProps {
  videoId: string | null
}

export function ChatPanel({ videoId }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamingContent])
  useEffect(() => { setMessages([]); setStreamingContent('') }, [videoId])

  const disabled = !videoId || isStreaming

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const query = input.trim()
    if (!query || disabled || !videoId) return
    setInput(''); setIsStreaming(true); setStreamingContent('')
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: query, timestamp: Date.now() }
    setMessages((prev) => [...prev, userMsg])
    abortRef.current = new AbortController()
    try {
      await runAgentLoop(query, videoId, messages, {
        onToken: (token) => setStreamingContent((prev) => prev + token),
        onAssistantMessage: (msg) => { setMessages((prev) => [...prev, msg]); setStreamingContent('') },
        onError: (err) => console.error('Agent error:', err),
      }, abortRef.current.signal)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') console.error(err)
    } finally { setIsStreaming(false); setStreamingContent('') }
  }

  return (
    <div className="chat-panel">
      <div className="chat-panel__header">
        <span className="chat-panel__title">Video Chat</span>
        <span className="chat-panel__subtitle">Ask questions about your video</span>
      </div>
      <div className="chat-panel__messages">
        {messages.length === 0 && (
          <div className="chat-panel__empty">
            {videoId ? (
              <><p>Video loaded. Ask anything about what's in the video.</p>
              <p className="chat-panel__empty-hint">Try: "What's happening in this video?" or "Describe the main scene"</p></>
            ) : <p>Upload a video above to start chatting.</p>}
          </div>
        )}
        {messages.filter((m) => m.role !== 'tool').map((msg) => <MessageBubble key={msg.id} message={msg} />)}
        {isStreaming && streamingContent && (
          <MessageBubble message={{ id: 'streaming', role: 'assistant', content: streamingContent, timestamp: Date.now() }} isStreaming />
        )}
        <div ref={bottomRef} />
      </div>
      <form className="chat-panel__form" onSubmit={handleSubmit}>
        <input className="chat-panel__input" type="text" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder={videoId ? 'Ask about the video…' : 'Upload a video first…'} disabled={disabled} autoFocus />
        <button className="chat-panel__send" type="submit" disabled={disabled || !input.trim()} aria-label="Send">
          {isStreaming ? '◼' : '↑'}
        </button>
      </form>
    </div>
  )
}
