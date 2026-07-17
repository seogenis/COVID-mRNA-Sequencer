import { useEffect, useState } from 'react'
import { Scene } from './scene/Scene'
import { Toolbar } from './ui/Toolbar'
import { SidePanel } from './ui/SidePanel'
import { Inspector } from './ui/Inspector'
import { LinkingBanner } from './ui/LinkingBanner'
import { HistoryDrawer } from './ui/HistoryDrawer'
import { SettingsModal } from './ui/SettingsModal'
import { AiModal } from './ui/AiModal'
import { useStore } from './store'

export default function App() {
  const cancelLinking = useStore((s) => s.cancelLinking)
  const select = useStore((s) => s.select)
  const selectedId = useStore((s) => s.selectedId)
  const deleteNode = useStore((s) => s.deleteNode)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'
      if (e.key === 'Escape') {
        // Close the topmost overlay first; otherwise clear selection/linking.
        if (aiOpen) setAiOpen(false)
        else if (settingsOpen) setSettingsOpen(false)
        else if (historyOpen) setHistoryOpen(false)
        else {
          cancelLinking()
          select(null)
        }
      }
      if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        deleteNode(selectedId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancelLinking, select, selectedId, deleteNode, aiOpen, settingsOpen, historyOpen])

  return (
    <div className="app">
      <Scene />
      <Toolbar onOpenHistory={() => setHistoryOpen(true)} onOpenSettings={() => setSettingsOpen(true)} onOpenAi={() => setAiOpen(true)} />
      <SidePanel />
      <Inspector />
      <LinkingBanner />
      {historyOpen && <HistoryDrawer onClose={() => setHistoryOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {aiOpen && <AiModal onClose={() => setAiOpen(false)} />}
    </div>
  )
}
