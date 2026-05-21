import { useRef, useState } from 'react'
import { uploadVideo } from '../services/vlmService'
import type { VideoSession } from '../types'
import './VideoUpload.css'

interface VideoUploadProps { onUpload: (session: VideoSession) => void }

export function VideoUpload({ onUpload }: VideoUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setError(null); setUploading(true)
    try {
      const result = await uploadVideo(file)
      onUpload({ videoId: result.video_id, filename: result.filename, duration: result.duration })
    } catch (err) { setError((err as Error).message) }
    finally { setUploading(false) }
  }

  return (
    <div
      className={`video-upload${dragOver ? ' video-upload--drag-over' : ''}${uploading ? ' video-upload--uploading' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
      onClick={() => !uploading && inputRef.current?.click()}
      role="button" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && !uploading && inputRef.current?.click()}
      aria-label="Upload video"
    >
      <input ref={inputRef} type="file"
        accept="video/mp4,video/avi,video/quicktime,video/x-matroska,video/webm,.mp4,.avi,.mov,.mkv,.webm"
        style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} disabled={uploading} />
      <div className="video-upload__icon">{uploading ? '⏳' : '🎬'}</div>
      {uploading ? <p className="video-upload__label">Uploading…</p> : (
        <><p className="video-upload__label">Drop a video here or click to browse</p>
        <p className="video-upload__hint">MP4 · AVI · MOV · MKV · WebM</p></>
      )}
      {error && <p className="video-upload__error">{error}</p>}
    </div>
  )
}
