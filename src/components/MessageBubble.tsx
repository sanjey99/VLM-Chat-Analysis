import type { Message } from '../types'
import './MessageBubble.css'

interface MessageBubbleProps {
  message: Message
  isStreaming?: boolean
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div className={`message-bubble message-bubble--${isUser ? 'user' : 'assistant'}`}>
      {!isUser && (
        <div className="message-bubble__label">Nika</div>
      )}
      <div className="message-bubble__content">
        {message.content}
        {isStreaming && <span className="message-bubble__cursor" aria-hidden />}
      </div>
    </div>
  )
}
