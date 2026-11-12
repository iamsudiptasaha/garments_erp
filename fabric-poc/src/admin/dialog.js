import React, { useEffect, useRef } from 'react';
const h = React.createElement;

export function AdminDialog({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => ref.current.showModal(), []);
  return h(
    'dialog',
    {
      className: 'fabric-dialog admin-dialog',
      ref,
      onCancel: (event) => {
        event.preventDefault();
        onClose();
      },
      'aria-label': title,
    },
    h(
      'div',
      { className: 'editor-heading' },
      h('h2', null, title),
      h('button', { type: 'button', onClick: onClose }, 'Close'),
    ),
    children,
  );
}
