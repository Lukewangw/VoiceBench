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
