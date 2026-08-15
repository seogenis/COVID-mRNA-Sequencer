import { HOSTED } from '../lib/env'

export function Onboarding({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal onboarding" onClick={(e) => e.stopPropagation()}>
        <div className="onb-hero">
          <div className="onb-mark">◈</div>
          <div>
            <h2>Welcome to Atlas</h2>
            <p>A map of your strategy space. Where a node sits means something.</p>
          </div>
        </div>

        <div className="onb-axes">
          <div className="onb-axis">
            <div className="onb-axis-key" style={{ color: '#8b7cff' }}>
              ↕ Rows
            </div>
            <div className="onb-axis-val">
              <strong>Altitude.</strong> Three bands: <em>Strategy</em> on top, <em>Project</em> in the middle,{' '}
              <em>Execution</em> at the bottom. Drag a card up or down to change its altitude.
            </div>
          </div>
          <div className="onb-axis">
            <div className="onb-axis-key" style={{ color: '#5aa9e6' }}>
              ↔ Columns
            </div>
            <div className="onb-axis-val">
              <strong>Time.</strong> Past on the left, roadmap on the right. A yellow <em>NOW</em> line marks today —
              drag a card sideways to reschedule it.
            </div>
          </div>
          <div className="onb-axis">
            <div className="onb-axis-key" style={{ color: '#4bd0a0' }}>
              ● Colour
            </div>
            <div className="onb-axis-val">
              <strong>Branch.</strong> Each strategic thread has its own colour. Filter to one when you want to focus.
            </div>
          </div>
        </div>

        <div className="onb-cols">
          <div>
            <div className="onb-h">Move around</div>
            <ul>
              <li>
                <strong>Drag the background</strong> to pan
              </li>
              <li>
                <strong>Scroll</strong> to zoom (toward the cursor)
              </li>
              <li>
                <strong>Double-click a card</strong> to zoom to it
              </li>
              <li>
                <strong>F</strong> or <strong>⤢ Frame all</strong> to fit everything
              </li>
            </ul>
          </div>
          <div>
            <div className="onb-h">Work with it</div>
            <ul>
              <li>
                <strong>Drag a card</strong> to move it — across a band to re-altitude, sideways to reschedule
              </li>
              <li>
                <strong>Double-click empty space</strong> to create a node there (its spot sets date &amp; altitude)
              </li>
              <li>
                Click a card → edit in the <strong>inspector</strong>; its links light up
              </li>
              <li>
                <strong>Ctrl/⌘+Z</strong> undoes moves, adds, deletes &amp; AI changes
              </li>
              <li>
                <strong>✦ AI</strong> → paste a brain-dump into <em>Compose</em>
              </li>
            </ul>
          </div>
        </div>

        {HOSTED && (
          <p className="field-hint keyless onb-note">
            This is the hosted preview — everything works except the ✦ AI features, which call Anthropic directly and
            are blocked by the sandbox. Run the dev build (see the repo README) with your API key to use them.
          </p>
        )}

        <div className="onb-foot">
          <span className="muted-text">Reopen this anytime with the “?” button.</span>
          <button className="btn primary" onClick={onClose}>
            Explore the space
          </button>
        </div>
      </div>
    </div>
  )
}
