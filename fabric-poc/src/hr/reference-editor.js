import { createElement as h, useEffect, useId, useRef, useState } from 'react';
import { ReviewForm, useSaveReview } from '../fabric/save-review.js';

export function ReferenceEditor({ record, singular, onSave, onClose }) {
  const dialog = useRef(null);
  const heading = useId();
  const field = useId();
  const [name, setName] = useState(record?.name ?? '');
  const review = useSaveReview();

  useEffect(() => {
    const modal = dialog.current;
    modal.showModal();
    return () => modal.close();
  }, []);

  return h(
    'dialog',
    {
      ref: dialog,
      className: 'fabric-dialog hr-reference-editor',
      'aria-labelledby': heading,
      onClose: (event) => {
        if (!event.currentTarget.open) onClose();
      },
      onCancel: (event) => {
        if (review.busy) event.preventDefault();
      },
    },
    h(
      'div',
      { className: 'editor-heading' },
      h(
        'div',
        null,
        h('small', null, review.pending ? 'CHECK & CONFIRM' : 'REFERENCE DETAILS'),
        h('h2', { id: heading }, (record ? 'Edit ' : 'New ') + singular),
      ),
      h('form', { method: 'dialog' }, h('button', { disabled: review.busy }, 'Close')),
    ),
    h(
      ReviewForm,
      {
        review,
        onSubmit: () => {
          const value = name.trim();
          const rows = record
            ? [
                ['Previous name', record.name],
                ['Name', value],
              ]
            : [['Name', value]];
          review.prepare(
            value,
            rows,
            async (name) => {
              await onSave(record, name);
              dialog.current?.close();
            },
            'Review ' + singular,
          );
        },
      },
      h(
        'div',
        { className: 'fabric-line fabric-fields' },
        h(
          'label',
          { htmlFor: field },
          'Name',
          h('input', {
            id: field,
            ref: (input) => input?.setAttribute('autofocus', ''),
            required: true,
            maxLength: 100,
            pattern: '.*\\S.*',
            value: name,
            onChange: (event) => setName(event.target.value),
          }),
        ),
      ),
      h(
        'div',
        { className: 'editor-actions' },
        h('button', { className: 'primary' }, 'Review details →'),
      ),
    ),
  );
}
