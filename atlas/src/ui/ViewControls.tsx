import { useStore } from '../store'

export function ViewControls({ onHelp }: { onHelp: () => void }) {
  const frameAll = useStore((s) => s.frameAll)
  const nodeCount = useStore((s) => Object.keys(s.nodes).length)
  const inspectorOpen = useStore((s) => s.selectedId !== null)

  return (
    <div className={`view-controls ${inspectorOpen ? 'shifted' : ''}`}>
      <div className="view-count">{nodeCount} nodes</div>
      <button className="btn" onClick={frameAll} title="Frame everything (fit to view)">
        ⤢ Frame all
      </button>
      <button className="btn icon" onClick={onHelp} title="How to use Atlas">
        ?
      </button>
    </div>
  )
}
