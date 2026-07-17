import { useStore } from '../store'
import { EDGE_LABEL } from '../config'

export function LinkingBanner() {
  const linkingFrom = useStore((s) => s.linkingFrom)
  const linkKind = useStore((s) => s.linkKind)
  const nodes = useStore((s) => s.nodes)
  const cancelLinking = useStore((s) => s.cancelLinking)

  if (!linkingFrom) return null
  const from = nodes[linkingFrom]

  return (
    <div className="linking-banner">
      <span className="pulse-dot" />
      <span>
        Linking <strong>{from?.title}</strong> — <em>{EDGE_LABEL[linkKind]}</em> → click a target node
      </span>
      <button className="link" onClick={cancelLinking}>
        cancel (Esc)
      </button>
    </div>
  )
}
