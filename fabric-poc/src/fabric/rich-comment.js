import React, { useEffect, useId, useRef } from 'react';
const h = React.createElement;
const allowed = new Set(['P', 'DIV', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI']);
const isFormatted = (value) => /<\/?(?:p|div|br|strong|b|em|i|u|ul|ol|li)(?:\s|>|\/)/i.test(value);

export function commentText(value = '') {
  if (!isFormatted(value)) return value;
  return value
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(?:amp|lt|gt|quot|#39|nbsp);/g,
      (entity) =>
        ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' })[
          entity
        ],
    )
    .trim();
}

// Only semantic formatting is accepted; pasted attributes, links and active content are removed.
function safeComment(value = '') {
  const doc = new DOMParser().parseFromString('', 'text/html');
  if (!isFormatted(value)) {
    doc.body.textContent = value;
    return doc.body.innerHTML;
  }
  const source = new DOMParser().parseFromString(value, 'text/html');
  function copy(node, parent) {
    if (node.nodeType === 3) {
      parent.append(doc.createTextNode(node.textContent));
      return;
    }
    if (node.nodeType !== 1 || ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(node.tagName))
      return;
    const target = allowed.has(node.tagName) ? doc.createElement(node.tagName) : parent;
    if (target !== parent) parent.append(target);
    for (const child of node.childNodes) copy(child, target);
  }
  for (const node of source.body.childNodes) copy(node, doc.body);
  return doc.body.innerHTML;
}

export function RichComment({ value }) {
  return h('div', {
    className: 'fabric-rich-content',
    dangerouslySetInnerHTML: { __html: safeComment(value || '') },
  });
}

export function RichCommentEditor({ value, onChange }) {
  const ref = useRef(null),
    labelId = useId();
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current)
      ref.current.innerHTML = safeComment(value);
  }, [value]);
  function publish() {
    onChange(safeComment(ref.current.innerHTML));
  }
  return h(
    'div',
    { className: 'fabric-rich-editor' },
    h('span', { id: labelId }, 'Comments for this colour'),
    h(
      'div',
      { className: 'fabric-rich-toolbar', role: 'group', 'aria-label': 'Comment formatting' },
      [
        ['bold', 'Bold', 'B'],
        ['italic', 'Italic', 'I'],
        ['underline', 'Underline', 'U'],
        ['insertUnorderedList', 'Bulleted list', '• List'],
        ['insertOrderedList', 'Numbered list', '1. List'],
        ['removeFormat', 'Clear formatting', 'Clear'],
      ].map(([command, label, text]) =>
        h(
          'button',
          {
            key: command,
            type: 'button',
            title: label,
            'aria-label': label,
            onMouseDown: (event) => event.preventDefault(),
            onClick: () => {
              ref.current.focus();
              document.execCommand(command, false);
              publish();
            },
          },
          text,
        ),
      ),
    ),
    h('div', {
      ref,
      className: 'fabric-rich-content fabric-rich-input',
      contentEditable: true,
      suppressContentEditableWarning: true,
      role: 'textbox',
      'aria-multiline': true,
      'aria-labelledby': labelId,
      onInput: publish,
      onPaste: (event) => {
        event.preventDefault();
        const html = event.clipboardData.getData('text/html');
        const text = event.clipboardData.getData('text/plain');
        document.execCommand('insertHTML', false, safeComment(html || text));
        publish();
      },
    }),
  );
}
