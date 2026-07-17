import { useRef } from 'react'
import { useStore } from '../store'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me)
  const setMe = useStore((s) => s.setMe)
  const settings = useStore((s) => s.settings)
  const setSetting = useStore((s) => s.setSetting)
  const exportState = useStore((s) => s.exportState)
  const importState = useStore((s) => s.importState)
  const resetSeed = useStore((s) => s.resetSeed)
  const autoLayout = useStore((s) => s.autoLayout)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleExport = () => {
    const blob = new Blob([exportState()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'atlas-export.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const ok = importState(String(reader.result))
      if (!ok) alert('Import failed — not a valid Atlas export.')
      else onClose()
    }
    reader.readAsText(file)
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span>Settings</span>
          <button className="link" onClick={onClose}>
            close ✕
          </button>
        </div>

        <div className="modal-body">
          <label className="field">
            Your name (shown as author — no login yet)
            <input value={me} onChange={(e) => setMe(e.target.value)} />
          </label>

          <label className="check-row big">
            <input
              type="checkbox"
              checked={settings.showLevelPlanes}
              onChange={(e) => setSetting('showLevelPlanes', e.target.checked)}
            />
            <span>Show altitude floors</span>
          </label>
          <label className="check-row big">
            <input
              type="checkbox"
              checked={settings.showTimeGrid}
              onChange={(e) => setSetting('showTimeGrid', e.target.checked)}
            />
            <span>Show time grid & NOW marker</span>
          </label>

          <label className="field">
            Anthropic API key (optional — enables ✦ Organize with AI)
            <input
              type="password"
              placeholder="sk-ant-…"
              value={settings.anthropicApiKey}
              onChange={(e) => setSetting('anthropicApiKey', e.target.value)}
            />
            <span className="field-hint">
              Stored only in your browser's local storage. Calls Anthropic directly from this page.
            </span>
          </label>

          <div className="settings-actions">
            <button className="btn" onClick={autoLayout}>
              Re-snap layout
            </button>
            <button className="btn" onClick={handleExport}>
              Export JSON
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Import JSON
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])}
            />
            <button
              className="btn danger"
              onClick={() => {
                if (confirm('Reset everything back to the Synphony seed? This wipes your changes.')) {
                  resetSeed()
                  onClose()
                }
              }}
            >
              Reset to seed
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
