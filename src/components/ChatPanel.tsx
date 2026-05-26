import { useEffect, useRef, useState } from 'react'
import type { Message, CompareMetrics } from '../types'
import { MessageBubble } from './MessageBubble'
import { ComparePanel, type ColState } from './ComparePanel'
import { runAgentLoop } from '../services/agentLoop'
import { streamCompare } from '../services/vlmService'
import { saveLog } from '../services/chatStore'
import './ChatPanel.css'

interface ChatPanelProps {
  videoId: string | null
  filename: string | null
  mediaType: 'video' | 'image'
  modelId: string | null
  modelReady: boolean
  baseReady: boolean
}

const EMPTY_COL: ColState = { model: '', response: '', metrics: null, streaming: false }

export function ChatPanel({ videoId, filename, mediaType, modelId, modelReady, baseReady }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const logIdRef = useRef<string | null>(null)

  // Compare mode state
  const [compareMode, setCompareMode] = useState(false)
  const [leftCol, setLeftCol] = useState<ColState>(EMPTY_COL)
  const [rightCol, setRightCol] = useState<ColState>(EMPTY_COL)
  const [rougeL, setRougeL] = useState<number | null>(null)
  const [compareStatus, setCompareStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [compareError, setCompareError] = useState('')

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamingContent])
  useEffect(() => {
    setMessages([])
    setStreamingContent('')
    setCompareStatus('idle')
    setLeftCol(EMPTY_COL)
    setRightCol(EMPTY_COL)
    setRougeL(null)
    logIdRef.current = null
  }, [videoId])

  useEffect(() => {
    const visible = messages.filter(m => m.role !== 'tool')
    if (visible.length < 2 || !videoId || !modelId || !filename) return
    if (visible[visible.length - 1].role !== 'assistant') return
    if (!logIdRef.current) logIdRef.current = crypto.randomUUID()
    saveLog({
      id: logIdRef.current,
      filename,
      mediaType,
      modelId,
      messages,
      messageCount: visible.length,
      createdAt: messages[0].timestamp,
      updatedAt: Date.now(),
    })
  }, [messages, videoId, modelId, filename, mediaType])

  const disabled = !videoId || isStreaming || !modelReady

  async function handleCompare(query: string, vid: string) {
    let firstModel = ''
    setCompareStatus('running')
    setRougeL(null)
    setCompareError('')
    setLeftCol(EMPTY_COL)
    setRightCol(EMPTY_COL)

    abortRef.current = new AbortController()
    try {
      for await (const event of streamCompare(vid, query, abortRef.current.signal)) {
        if ('error' in event) {
          setCompareStatus('error')
          setCompareError(event.error)
          return
        }
        if (event.phase === 'start_model') {
          if (!firstModel) {
            firstModel = event.model
            setLeftCol({ model: event.model, response: '', metrics: null, streaming: true })
          } else {
            setRightCol({ model: event.model, response: '', metrics: null, streaming: true })
          }
        } else if (event.phase === 'token') {
          if (event.model === firstModel) {
            setLeftCol((prev) => ({ ...prev, response: prev.response + event.token }))
          } else {
            setRightCol((prev) => ({ ...prev, response: prev.response + event.token }))
          }
        } else if (event.phase === 'model_done') {
          const metrics = event.metrics as CompareMetrics
          if (event.model === firstModel) {
            setLeftCol((prev) => ({ ...prev, metrics, streaming: false }))
          } else {
            setRightCol((prev) => ({ ...prev, metrics, streaming: false }))
          }
        } else if (event.phase === 'compare_done') {
          setRougeL(event.rouge_l)
          setCompareStatus('done')
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setCompareStatus('error')
        setCompareError((err as Error).message)
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const query = input.trim()
    if (!query || disabled || !videoId) return
    setInput('')
    setIsStreaming(true)

    if (compareMode) {
      try {
        await handleCompare(query, videoId)
      } finally {
        setIsStreaming(false)
      }
      return
    }

    setStreamingContent('')
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
    } finally {
      setIsStreaming(false)
      setStreamingContent('')
    }
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  function toggleCompare() {
    setCompareMode((m) => !m)
    setCompareStatus('idle')
    setLeftCol(EMPTY_COL)
    setRightCol(EMPTY_COL)
    setRougeL(null)
  }

  const compareDisabled = !baseReady

  return (
    <div className="chat-panel">
      <div className="chat-panel__header">
        <div>
          <span className="chat-panel__title">{compareMode ? 'Compare Mode' : 'Video Chat'}</span>
          <span className="chat-panel__subtitle">
            {compareMode ? 'Specialist vs Qwen2.5-VL-7B base' : 'Ask questions about your video'}
          </span>
        </div>
        <button
          className={`chat-panel__compare-btn${compareMode ? ' active' : ''}`}
          onClick={toggleCompare}
          disabled={!modelReady || compareDisabled}
          title={compareDisabled ? 'Base model still loading…' : 'Toggle compare mode'}
        >
          {compareDisabled ? '⏳ Base loading' : compareMode ? '✕ Compare' : '⇄ Compare'}
        </button>
      </div>

      {compareMode ? (
        <ComparePanel
          leftCol={leftCol}
          rightCol={rightCol}
          rougeL={rougeL}
          status={compareStatus}
          error={compareError}
        />
      ) : (
        <div className="chat-panel__messages">
          {messages.length === 0 && (
            <div className="chat-panel__empty">
              {!modelReady ? (
                <p>Select a model above to get started.</p>
              ) : videoId ? (
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
      )}

      <form className="chat-panel__form" onSubmit={handleSubmit}>
        <input className="chat-panel__input" type="text" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder={
            !modelReady ? 'Waiting for model…' :
            compareMode ? 'Ask to compare both models…' :
            videoId ? 'Ask about the video…' : 'Upload a video first…'
          }
          disabled={disabled} autoFocus />
        <button
          className="chat-panel__send"
          type={isStreaming ? 'button' : 'submit'}
          onClick={isStreaming ? handleStop : undefined}
          disabled={!isStreaming && (disabled || !input.trim())}
          aria-label={isStreaming ? 'Stop' : 'Send'}
        >
          {isStreaming ? '◼' : '↑'}
        </button>
      </form>
    </div>
  )
}
