import { useStore } from '../store'

export function ViewControls({ onHelp }: { onHelp: () => void }) {
  const frameAll = useStore((s) => s.frameAll)
  const nodeCount = useStore((s) => Object.keys(s.nodes).length)
  const inspectorOpen = useStore((s) => s.selectedId !== null)
  const layoutMode = useStore((s) => s.layoutMode)
  const setLayoutMode = useStore((s) => s.setLayoutMode)

  return (
    <div className={`view-controls ${inspectorOpen ? 'shifted' : ''}`}>
      <div className="view-count">{nodeCount} nodes</div>
      <div className="layout-toggle" role="tablist" aria-label="Layout">
        <button
          className={`lt ${layoutMode === 'timeline' ? 'active' : ''}`}
          onClick={() => setLayoutMode('timeline')}
          title="Lay out by time"
        >
          ◱ Timeline
        </button>
        <button
          className={`lt ${layoutMode === 'grouped' ? 'active' : ''}`}
          onClick={() => setLayoutMode('grouped')}
          title="Auto-organize into a tidy tree by branch & hierarchy"
        >
          ❖ Organized
        </button>
      </div>
      <button className="btn" onClick={frameAll} title="Frame everything (fit to view)">
        ⤢ Frame all
      </button>
      <button className="btn icon" onClick={onHelp} title="How to use Atlas">
        ?
      </button>
    </div>
  )
}
