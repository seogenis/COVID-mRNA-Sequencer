// A deliberately tiny markdown -> HTML renderer. No dependency, handles the
// subset used in node bodies: headings, bold, italic, inline code, links,
// bullet lists, and [ ] / [x] checkboxes. Everything is escaped first.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}

export function renderMarkdown(src: string): string {
  const lines = escapeHtml(src).split('\n')
  const out: string[] = []
  let inList = false

  const closeList = () => {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      closeList()
      continue
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      closeList()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }
    const checkbox = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/)
    if (checkbox) {
      if (!inList) {
        out.push('<ul class="md-list">')
        inList = true
      }
      const checked = checkbox[1].toLowerCase() === 'x'
      out.push(
        `<li class="md-check ${checked ? 'done' : ''}"><span class="box">${checked ? '✓' : ''}</span>${inline(checkbox[2])}</li>`,
      )
      continue
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    if (bullet) {
      if (!inList) {
        out.push('<ul class="md-list">')
        inList = true
      }
      out.push(`<li>${inline(bullet[1])}</li>`)
      continue
    }
    closeList()
    out.push(`<p>${inline(line)}</p>`)
  }
  closeList()
  return out.join('\n')
}
