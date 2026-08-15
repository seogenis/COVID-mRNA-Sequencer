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
              ↕ Height
            </div>
            <div className="onb-axis-val">
              <strong>Altitude.</strong> Three floors: <em>Strategy</em> up top, <em>Project</em> in the middle,{' '}
              <em>Execution</em> down low.
            </div>
          </div>
          <div className="onb-axis">
            <div className="onb-axis-key" style={{ color: '#5aa9e6' }}>
              ↔ Left→right
            </div>
            <div className="onb-axis-val">
              <strong>Time.</strong> Past on the left, roadmap on the right. A yellow <em>NOW</em> wall marks today.
            </div>
          </div>
          <div className="onb-axis">
            <div className="onb-axis-key" style={{ color: '#4bd0a0' }}>
              ⤢ Depth
            </div>
            <div className="onb-axis-val">
              <strong>Branch.</strong> Each strategic thread gets its own lane going into the screen.
            </div>
          </div>
        </div>

        <div className="onb-cols">
          <div>
            <div className="onb-h">Move around</div>
            <ul>
              <li>
                <strong>Drag</strong> to orbit
              </li>
              <li>
                <strong>Right-drag</strong> / two-finger to pan
              </li>
              <li>
                <strong>Scroll</strong> to zoom
              </li>
              <li>
                <strong>Double-click</strong> a node to fly to it
              </li>
              <li>
                <strong>⤢ Frame all</strong> (bottom-right) to reset the view
              </li>
            </ul>
          </div>
          <div>
            <div className="onb-h">Work with it</div>
            <ul>
              <li>
                <strong>Double-click an empty spot on a floor</strong> to create a node there — the position sets its
                date, branch, and altitude
              </li>
              <li>
                Click a node → edit in the <strong>inspector</strong>; its connections light up
              </li>
              <li>
                <strong>Filters / Outline</strong> on the left — including by <strong>person</strong>
              </li>
              <li>
                <strong>Ctrl/⌘+Z</strong> undoes adds, deletes &amp; AI changes
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
