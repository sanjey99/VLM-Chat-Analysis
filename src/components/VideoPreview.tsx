import { useEffect } from 'react'
import type { VideoSession } from '../types'
import './VideoPreview.css'

interface VideoPreviewProps { session: VideoSession; onClear: () => void }

function formatDuration(s: number): string {
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

export function VideoPreview({ session, onClear }: VideoPreviewProps) {
  const isImage = session.mediaType === 'image'

  useEffect(() => {
    return () => { if (session.localUrl) URL.revokeObjectURL(session.localUrl) }
  }, [session.localUrl])

  return (
    <div className="video-preview">
      <div className="video-preview__media">
        {session.localUrl ? (
          isImage
            ? <img src={session.localUrl} alt={session.filename} className="video-preview__asset" />
            : <video src={session.localUrl} className="video-preview__asset" controls muted playsInline />
        ) : (
          <span className="video-preview__placeholder">{isImage ? '🖼' : '▶'}</span>
        )}
      </div>
      <div className="video-preview__bar">
        <div className="video-preview__info">
          <p className="video-preview__filename">{session.filename}</p>
          {!isImage && <p className="video-preview__duration">{formatDuration(session.duration)}</p>}
        </div>
        <button className="video-preview__clear" onClick={onClear} aria-label="Remove file" title="Remove file">✕</button>
      </div>
    </div>
  )
}
