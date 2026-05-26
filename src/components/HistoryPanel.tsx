import { useEffect, useState } from 'react'
import type { ChatLog, ChatLogMeta } from '../types'
import { deleteLog, loadIndex, loadLog } from '../services/chatStore'
import { MessageBubble } from './MessageBubble'
import { MetricsChart } from './MetricsChart'
import './HistoryPanel.css'

interface HistoryPanelProps { onClose: () => void }

function formatDate(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function HistoryPanel({ onClose }: HistoryPanelProps) {
  const [metas, setMetas] = useState<ChatLogMeta[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedLog, setSelectedLog] = useState<ChatLog | null>(null)

  useEffect(() => { setMetas(loadIndex()) }, [])

  function handleSelect(id: string) {
    setSelectedId(id)
    setSelectedLog(loadLog(id))
  }

  function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    deleteLog(id)
    setMetas(prev => prev.filter(m => m.id !== id))
    if (selectedId === id) { setSelectedId(null); setSelectedLog(null) }
  }

  return (
    <div className="history-panel">
      <div className="history-panel__header">
        <span className="history-panel__title">Chat History</span>
        <button className="history-panel__close" onClick={onClose} aria-label="Close history">✕</button>
      </div>
      <div className="history-panel__body">
        <div className="history-panel__list">
          {metas.length === 0 ? (
            <p className="history-panel__empty-list">No saved chats yet.</p>
          ) : metas.map(m => (
            <button
              key={m.id}
              className={`history-log-item${selectedId === m.id ? ' history-log-item--active' : ''}`}
              onClick={() => handleSelect(m.id)}
            >
              <div className="history-log-item__top">
                <span className="history-log-item__model">{m.modelId}</span>
                <button className="history-log-item__delete" onClick={(e) => handleDelete(m.id, e)} aria-label="Delete log" title="Delete">✕</button>
              </div>
              <p className="history-log-item__filename">{m.filename}</p>
              <p className="history-log-item__meta">{m.messageCount} msgs · {formatDate(m.updatedAt)}</p>
            </button>
          ))}
        </div>

        <div className="history-panel__viewer">
          {!selectedLog ? (
            <p className="history-panel__empty-viewer">Select a chat from the list to view it.</p>
          ) : (
            <>
              <div className="history-panel__viewer-header">
                <span className="history-panel__viewer-filename">{selectedLog.filename}</span>
                <span className="history-panel__viewer-model">{selectedLog.modelId}</span>
              </div>
              <MetricsChart messages={selectedLog.messages} />
              <div className="history-panel__messages">
                {selectedLog.messages
                  .filter(m => m.role !== 'tool')
                  .map(msg => <MessageBubble key={msg.id} message={msg} />)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
