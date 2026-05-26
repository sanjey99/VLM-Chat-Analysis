import { useEffect, useRef, useState } from 'react'
import type { Message, CompareMetrics } from '../types'
import { MessageBubble } from './MessageBubble'
import { MetricsChart } from './MetricsChart'
import { ComparePanel, type ColState } from './ComparePanel'
import { runAgentLoop } from '../services/agentLoop'
import { streamCompare, getSystemInfo } from '../services/vlmService'
import { saveLog } from '../services/chatStore'
import './ChatPanel.css'

interface ChatPanelProps {
  videoId: string | null
  filename: string | null
  mediaType: 'video' | 'image'
  modelId: string | null
  modelReady: boolean
}

const EMPTY_COL: ColState = { model: '', response: '', metrics: null, streaming: false }

export function ChatPanel({ videoId, filename, mediaType, modelId, modelReady }: ChatPanelProps) {
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
  const [compareHistory, setCompareHistory] = useState<Array<{ query: string; leftResponse: string; rightResponse: string }>>([])
  const [vramSamples, setVramSamples] = useState<Array<{ t: number; gb: number }>>([])
  const compareStartRef = useRef<number>(0)
  const activeResponseRef = useRef('')
  const baseResponseRef = useRef('')

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamingContent])
  useEffect(() => {
    setMessages([])
    setStreamingContent('')
    setCompareStatus('idle')
    setLeftCol(EMPTY_COL)
    setRightCol(EMPTY_COL)
    setRougeL(null)
    setCompareHistory([])
    setVramSamples([])
    logIdRef.current = null
  }, [videoId])

  useEffect(() => {
    const visible = messages.filter(m => m.role !== 'tool')
    if (visible.length < 2 || !videoId || !modelId || !filename) return
    if (visible[visible.length - 1].role !== 'assistant') return
    if (!logIdRef.current) logIdRef.current = crypto.randomUUID()
    saveLog({
      id: logIdRef.current!,
      filename,
      mediaType,
      modelId,
      messages,
      messageCount: visible.length,
      createdAt: messages[0].timestamp,
      updatedAt: Date.now(),
    })
  }, [messages, videoId, modelId, filename, mediaType])

  // Poll VRAM while a compare is streaming so we can show a live GPU chart.
  useEffect(() => {
    if (!compareMode || !isStreaming) return
    const id = setInterval(async () => {
      try {
        const info = await getSystemInfo()
        if (info.vram_used_gb != null) {
          const t = Date.now() - compareStartRef.current
          setVramSamples((prev) => [...prev, { t, gb: info.vram_used_gb! }])
        }
      } catch {}
    }, 1500)
    return () => clearInterval(id)
  }, [compareMode, isStreaming])

  const disabled = !videoId || isStreaming || !modelReady

  async function handleCompare(query: string, vid: string) {
    let firstModel = ''
    setCompareStatus('running')
    setRougeL(null)
    setCompareError('')
    setLeftCol(EMPTY_COL)
    setRightCol(EMPTY_COL)
    compareStartRef.current = Date.now()
    setVramSamples([])
    activeResponseRef.current = ''
    baseResponseRef.current = ''

    const activeHistory = compareHistory.flatMap((h) => [
      { role: 'user' as const, content: h.query },
      { role: 'assistant' as const, content: h.leftResponse },
    ])
    const baseHistory = compareHistory.flatMap((h) => [
      { role: 'user' as const, content: h.query },
      { role: 'assistant' as const, content: h.rightResponse },
    ])

    abortRef.current = new AbortController()
    try {
      for await (const event of streamCompare(vid, query, activeHistory, baseHistory, abortRef.current.signal)) {
        if ('error' in event) {
          setCompareStatus('error')
          setCompareError(event.error)
          return
        }
        if (event.phase === 'loading_base') {
          setRightCol({ model: event.model, response: '', metrics: null, streaming: false, loadingModel: true })
        } else if (event.phase === 'start_model') {
          if (!firstModel) {
            firstModel = event.model
            setLeftCol({ model: event.model, response: '', metrics: null, streaming: true })
          } else {
            setRightCol({ model: event.model, response: '', metrics: null, streaming: true, loadingModel: false })
          }
        } else if (event.phase === 'token') {
          if (event.model === firstModel) {
            activeResponseRef.current += event.token
            setLeftCol((prev) => ({ ...prev, response: prev.response + event.token }))
          } else {
            baseResponseRef.current += event.token
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
          setCompareHistory((prev) => [...prev, {
            query,
            leftResponse: activeResponseRef.current,
            rightResponse: baseResponseRef.current,
          }])
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
    setCompareHistory([])
    setVramSamples([])
  }

  const compareDisabled = false  // base model loaded on demand during compare

  return (
    <div className="chat-panel">
      <div className="chat-panel__header">
        <div>
          <span className="chat-panel__title">{compareMode ? 'Compare Mode' : 'Video Chat'}</span>
          <span className="chat-panel__subtitle">
            {compareMode ? 'Specialist vs selected base model' : 'Ask questions about your video'}
          </span>
        </div>
        <button
          className={`chat-panel__compare-btn${compareMode ? ' active' : ''}`}
          onClick={toggleCompare}
          disabled={!modelReady}
          title="Compare specialist vs base model (loads base on demand)"
        >
          {compareMode ? '✕ Compare' : '⇄ Compare'}
        </button>
      </div>

      {compareMode ? (
        <ComparePanel
          leftCol={leftCol}
          rightCol={rightCol}
          rougeL={rougeL}
          status={compareStatus}
          error={compareError}
          vramSamples={vramSamples}
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

      {!compareMode && <MetricsChart messages={messages} />}

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
