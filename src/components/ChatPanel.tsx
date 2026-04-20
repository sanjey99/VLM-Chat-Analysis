import { useState, useRef, useEffect } from 'react'
import type { Message, GeoJSONPoint } from '../types'
import { MessageBubble } from './MessageBubble'
import { runAgentLoop } from '../services/agentLoop'
import './ChatPanel.css'

interface ChatPanelProps {
  onMapData: (points: GeoJSONPoint[]) => void
}

export function ChatPanel({ onMapData }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const query = input.trim()
    if (!query || isStreaming) return

    setInput('')
    setIsStreaming(true)
    setStreamingContent('')

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: query,
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])

    abortRef.current = new AbortController()

    try {
      await runAgentLoop(
        query,
        messages,
        {
          onToken: (token) => setStreamingContent((prev) => prev + token),
          onAssistantMessage: (msg) => {
            setMessages((prev) => [...prev, msg])
            setStreamingContent('')
          },
          onToolCall: () => setStreamingContent(''),
          onMapData,
          onError: (err) => console.error('Agent error:', err),
        },
        abortRef.current.signal
      )
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error(err)
      }
    } finally {
      setIsStreaming(false)
      setStreamingContent('')
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-panel__header">
        <span className="chat-panel__title">Nika</span>
        <span className="chat-panel__subtitle">Your Singapore guide</span>
      </div>

      <div className="chat-panel__messages">
        {messages.length === 0 && (
          <div className="chat-panel__empty">
            <p>Ask me anything about places in Singapore.</p>
            <p className="chat-panel__empty-hint">Try: "Find ramen near Bugis" or "Parks in Punggol"</p>
          </div>
        )}
        {messages
          .filter((m) => m.role !== 'tool')
          .map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        {isStreaming && streamingContent && (
          <MessageBubble
            message={{ id: 'streaming', role: 'assistant', content: streamingContent, timestamp: Date.now() }}
            isStreaming
          />
        )}
        <div ref={bottomRef} />
      </div>

      <form className="chat-panel__form" onSubmit={handleSubmit}>
        <input
          className="chat-panel__input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about places in Singapore…"
          disabled={isStreaming}
          autoFocus
        />
        <button
          className="chat-panel__send"
          type="submit"
          disabled={isStreaming || !input.trim()}
          aria-label="Send"
        >
          {isStreaming ? '◼' : '↑'}
        </button>
      </form>
    </div>
  )
}
