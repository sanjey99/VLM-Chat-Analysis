import type { VideoSession } from '../types'
import './VideoPreview.css'

interface VideoPreviewProps { session: VideoSession; onClear: () => void }

function formatDuration(s: number): string {
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

export function VideoPreview({ session, onClear }: VideoPreviewProps) {
  return (
    <div className="video-preview">
      <span className="video-preview__icon">▶</span>
      <div className="video-preview__info">
        <p className="video-preview__filename">{session.filename}</p>
        <p className="video-preview__duration">{formatDuration(session.duration)}</p>
      </div>
      <button className="video-preview__clear" onClick={onClear} aria-label="Remove video" title="Remove video">✕</button>
    </div>
  )
}
