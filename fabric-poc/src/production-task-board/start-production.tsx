import { useEffect, useRef, useState } from 'react';
import Select from 'react-select';
import { startPortalProduction } from './portal-data';

type Props = {
  data: Parameters<typeof startPortalProduction>[0];
  onSave: (data: Props['data']) => void;
  onClose: () => void;
};
export function StartProduction({ data, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [part, setPart] = useState('');
  const [employee, setEmployee] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const stage = [...data.stage].sort((a, b) => a.sort_order - b.sort_order)[0];
  const options = data.item_part
    .filter((p) => !data.job.some((j) => j.item_part_id === p.id))
    .map((p) => ({
      value: p.id,
      label: `${data.item.find((i) => i.id === p.item_id)?.style_code || 'Item'} / ${data.part_list.find((n) => n.id === p.part_list_id)?.part || 'Part'}`,
    }));
  return (
    <dialog
      ref={dialog}
      className="studio-modal"
      onCancel={onClose}
      aria-labelledby="start-production-title"
      style={{ width: 'min(540px,94vw)', padding: 28, borderRadius: 16 }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            onSave(startPortalProduction(data, part, employee));
          } catch (cause) {
            setError((cause as Error).message);
          }
        }}
      >
        <header className="operator-intro">
          <div>
            <h2 id="start-production-title">Start production</h2>
            <p>One task per item part. The first stage is {stage?.name || 'not configured'}.</p>
          </div>
        </header>
        <label className="operator-field">
          Item / part
          <Select
            unstyled
            classNamePrefix="operator-design"
            aria-label="Start item / part"
            isSearchable
            options={options}
            value={options.find((o) => o.value === part) || null}
            onChange={(o) => setPart(o?.value || '')}
          />
        </label>
        <label className="operator-field">
          Started by
          <select
            aria-label="Started by"
            required
            value={employee}
            onChange={(e) => setEmployee(e.target.value)}
          >
            <option value="">Select your name…</option>
            {data.employee
              .filter((e) => e.is_active !== false)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name || e.employee_name}
                </option>
              ))}
          </select>
        </label>
        <p className="fine-print">
          Sizes and planned pieces come from Items. No stage output is submitted until handover.
        </p>
        {error && <p role="alert">{error}</p>}
        <footer className="operator-submit">
          <button type="button" className="outline-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={!part || !employee || !stage} type="submit">
            Start at {stage?.name || 'first stage'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
