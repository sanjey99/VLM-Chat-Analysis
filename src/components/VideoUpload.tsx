import { useRef, useState } from 'react'
import { uploadVideo } from '../services/vlmService'
import type { VideoSession } from '../types'
import './VideoUpload.css'

interface VideoUploadProps {
  onUpload: (session: VideoSession) => void
  inputType?: 'video' | 'image'
}

const VIDEO_ACCEPT = 'video/mp4,video/avi,video/quicktime,video/x-matroska,video/webm,.mp4,.avi,.mov,.mkv,.webm'
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/bmp,image/tiff,.jpg,.jpeg,.png,.webp,.bmp,.tiff'

export function VideoUpload({ onUpload, inputType = 'video' }: VideoUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const isImage = inputType === 'image'
  const accept = isImage ? IMAGE_ACCEPT : VIDEO_ACCEPT
  const icon = uploading ? '⏳' : isImage ? '🖼️' : '🎬'
  const dropLabel = isImage ? 'Drop an image here or click to browse' : 'Drop a video here or click to browse'
  const hint = isImage ? 'JPG · PNG · WebP · BMP' : 'MP4 · AVI · MOV · MKV · WebM'
  const ariaLabel = isImage ? 'Upload image' : 'Upload video'

  async function handleFile(file: File) {
    setError(null); setUploading(true)
    try {
      const result = await uploadVideo(file)
      onUpload({
        videoId: result.video_id,
        filename: result.filename,
        duration: result.duration,
        mediaType: result.media_type,
      })
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
      aria-label={ariaLabel}
    >
      <input ref={inputRef} type="file"
        accept={accept}
        style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} disabled={uploading} />
      <div className="video-upload__icon">{icon}</div>
      {uploading ? <p className="video-upload__label">Uploading…</p> : (
        <><p className="video-upload__label">{dropLabel}</p>
        <p className="video-upload__hint">{hint}</p></>
      )}
      {error && <p className="video-upload__error">{error}</p>}
    </div>
  )
}
