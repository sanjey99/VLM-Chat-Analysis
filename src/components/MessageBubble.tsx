import type { Message } from '../types'
import './MessageBubble.css'

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const m = message.metrics
  return (
    <div className={`message-bubble message-bubble--${isUser ? 'user' : 'assistant'}`}>
      {!isUser && <div className="message-bubble__label">VLM</div>}
      <div className="message-bubble__content">
        {message.content}
        {isStreaming && <span className="message-bubble__cursor" aria-hidden />}
      </div>
      {!isUser && m && (
        <div className="message-bubble__metrics">
          <span title="Time to first token">{m.ttft_ms}ms TTFT</span>
          <span className="message-bubble__metrics-sep">·</span>
          <span title="Token generation speed">{m.tokens_per_sec} tok/s</span>
          <span className="message-bubble__metrics-sep">·</span>
          <span title="Total generation time">{(m.total_ms / 1000).toFixed(1)}s</span>
          <span className="message-bubble__metrics-sep">·</span>
          <span title="Tokens generated">{m.token_count} tok</span>
          {m.vram_used_gb != null && (
            <>
              <span className="message-bubble__metrics-sep">·</span>
              <span title="GPU VRAM in use">{m.vram_used_gb} GB GPU</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
