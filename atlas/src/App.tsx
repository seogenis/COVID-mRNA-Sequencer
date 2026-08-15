import { useEffect, useState } from 'react'
import { Scene } from './scene/Scene'
import { Toolbar } from './ui/Toolbar'
import { SidePanel } from './ui/SidePanel'
import { Inspector } from './ui/Inspector'
import { LinkingBanner } from './ui/LinkingBanner'
import { HistoryDrawer } from './ui/HistoryDrawer'
import { SettingsModal } from './ui/SettingsModal'
import { AiModal } from './ui/AiModal'
import { ViewControls } from './ui/ViewControls'
import { Onboarding } from './ui/Onboarding'
import { useStore } from './store'

const INTRO_KEY = 'atlas-seen-intro-v1'

function seenIntro(): boolean {
  try {
    return globalThis.localStorage?.getItem(INTRO_KEY) === '1'
  } catch {
    return false
  }
}

export default function App() {
  const cancelLinking = useStore((s) => s.cancelLinking)
  const select = useStore((s) => s.select)
  const selectedId = useStore((s) => s.selectedId)
  const deleteNode = useStore((s) => s.deleteNode)
  const frameAll = useStore((s) => s.frameAll)
  const undo = useStore((s) => s.undo)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(!seenIntro())

  const closeHelp = () => {
    setHelpOpen(false)
    try {
      globalThis.localStorage?.setItem(INTRO_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'
      if (e.key === 'Escape') {
        // Close the topmost overlay first; otherwise clear selection/linking.
        if (helpOpen) closeHelp()
        else if (aiOpen) setAiOpen(false)
        else if (settingsOpen) setSettingsOpen(false)
        else if (historyOpen) setHistoryOpen(false)
        else {
          cancelLinking()
          select(null)
        }
      }
      if (!typing && e.key === 'f' && !e.metaKey && !e.ctrlKey) frameAll()
      if (!typing && e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        undo()
      }
      if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        deleteNode(selectedId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelLinking, select, selectedId, deleteNode, frameAll, undo, aiOpen, settingsOpen, historyOpen, helpOpen])

  return (
    <div className="app">
      <Scene />
      <Toolbar
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAi={() => setAiOpen(true)}
      />
      <SidePanel />
      <Inspector />
      <ViewControls onHelp={() => setHelpOpen(true)} />
      <LinkingBanner />
      {historyOpen && <HistoryDrawer onClose={() => setHistoryOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {aiOpen && <AiModal onClose={() => setAiOpen(false)} />}
      {helpOpen && <Onboarding onClose={closeHelp} />}
    </div>
  )
}
