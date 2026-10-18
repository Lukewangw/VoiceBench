import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.use({ gfm: true, breaks: true })

DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  // Task-list boxes are the only form control GitHub text gets: a comment must never be able to
  // draw something like a token field on a page that asks for tokens.
  if (data.tagName === 'input' && (node as Element).getAttribute('type') !== 'checkbox')
    node.parentNode?.removeChild(node)
})

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
  if (node.tagName === 'INPUT') node.setAttribute('disabled', '')
})

const OPTIONS = {
  // No styling or page-level hooks from untrusted text, so it can't dress itself up as board UI.
  FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'option', 'label', 'dialog'],
  FORBID_ATTR: ['style', 'class', 'id', 'name', 'tabindex', 'autofocus'],
}

// GitHub issue text is untrusted, so it is always sanitized before it reaches the page.
export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }), OPTIONS)
}

// An item's own text: what it says, without the sub-items listed under it.
function ownText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeName === 'UL' || node.nodeName === 'OL') return ''
  return [...node.childNodes].map(ownText).join('')
}

/**
 * Names each task-list box in rendered Markdown after its item, for screen readers. This runs on
 * the page itself once the sanitized HTML is in, so it only ever reads text that survived.
 */
export function labelTaskBoxes(root: HTMLElement) {
  for (const box of root.querySelectorAll('input[type="checkbox"]')) {
    const li = box.closest('li')
    const item = li && root.contains(li) ? li : box.parentElement
    const text = item ? ownText(item).replace(/\s+/g, ' ').trim() : ''
    box.setAttribute('aria-label', text.slice(0, 200) || 'Task')
  }
}
