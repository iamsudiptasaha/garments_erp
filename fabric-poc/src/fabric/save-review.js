import { createElement as h, useEffect, useRef, useState } from 'react';

export function useSaveReview() {
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const previousAttempt = useRef(null);

  function prepare(payload, rows, save, title = 'Review changes') {
    if (inFlight.current) return;
    const key = JSON.stringify(payload);
    if (previousAttempt.current?.key !== key) {
      previousAttempt.current = { key, id: crypto.randomUUID() };
    }
    setError('');
    setPending({ payload, rows, save, title, id: previousAttempt.current.id });
  }

  function back() {
    if (inFlight.current) return;
    setPending(null);
    setError('');
  }

  async function confirm() {
    if (!pending || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await pending.save(pending.payload, pending.id);
      previousAttempt.current = null;
      setPending(null);
    } catch (failure) {
      setError(failure.message || 'Unable to save. Try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return { pending, busy, error, prepare, back, confirm };
}

export function ReviewForm({ review, children, ...formProps }) {
  const editor = useRef(null);
  const submitter = useRef(null);
  const reviewing = Boolean(review.pending);
  useEffect(() => {
    if (!reviewing && editor.current?.contains(submitter.current)) submitter.current.focus();
  }, [reviewing]);

  return h(
    'div',
    null,
    h(
      'form',
      {
        ...formProps,
        ref: editor,
        hidden: reviewing,
        style: reviewing ? { ...formProps.style, display: 'none' } : formProps.style,
        onSubmit: (event) => {
          event.preventDefault();
          if (!reviewing) {
            submitter.current = event.nativeEvent.submitter || document.activeElement;
            formProps.onSubmit(event);
          }
        },
      },
      children,
    ),
    reviewing && h(ReviewDetails, { review }),
  );
}

function ReviewDetails({ review }) {
  const heading = useRef(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  if (!review.pending) return null;
  return h(
    'section',
    { className: 'fabric-line', 'aria-label': review.pending.title },
    h('h3', { ref: heading, tabIndex: -1 }, review.pending.title),
    h(
      'dl',
      { className: 'fabric-fields' },
      review.pending.rows.map(([label, value], index) =>
        h(
          'div',
          { key: index, style: { overflowWrap: 'anywhere' } },
          h('dt', null, label),
          h('dd', null, value === '' || value == null ? '—' : String(value)),
        ),
      ),
    ),
    review.error && h('p', { role: 'alert', className: 'form-error' }, review.error),
    h(
      'div',
      { className: 'editor-actions' },
      h(
        'button',
        { type: 'button', disabled: review.busy || review.locked, onClick: review.back },
        'Back to edit',
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'primary',
          disabled: review.busy,
          onClick: review.confirm,
        },
        review.busy ? 'Saving…' : 'Confirm save',
      ),
    ),
  );
}
