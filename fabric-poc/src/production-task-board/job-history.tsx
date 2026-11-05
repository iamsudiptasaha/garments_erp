import { useEffect, useMemo, useRef, useState } from 'react';
import { portalTasks } from './portal-data';

type Props = {
  data: Parameters<typeof portalTasks>[0];
  canUpdate: boolean;
  onUpdate: () => void;
};
export function JobHistory({ data, canUpdate, onUpdate }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [selected]);
  const tasks = useMemo(() => portalTasks(data), [data]);
  const rows = tasks.flatMap((task) => task.attempts.map((job) => ({ task, job })));
  const visible = rows.filter(({ task, job }) =>
    [task.style, task.part, job.code, job.stage, job.status]
      .join(' ')
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const detail = rows.find(({ job }) => job.id === selected);
  const handovers = detail?.task.handovers?.filter((h) => h.job === selected) || [];
  const links = (data.variant_item_per_job || []).filter((v) => v.job_id === selected);
  const pieces = (data.stage_pieces || []).filter((p) =>
    links.some((v) => v.id === p.variant_item_per_job_id),
  );
  return (
    <section className="lab-record-select">
      <header className="fabric-page-header">
        <div>
          <p className="eyebrow">PRODUCTION / JOB HISTORY</p>
          <h1>Job history</h1>
          <p>Stage attempts and recorded quantities. Use Update Tasks to hand over production.</p>
        </div>
        {canUpdate && (
          <button className="primary" onClick={onUpdate}>
            Update Tasks
          </button>
        )}
      </header>
      <div className="fabric-actions">
        <input
          type="search"
          aria-label="Search job history"
          placeholder="Search style, job or stage…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="lab-record-table-wrap" style={{ overflowX: 'auto' }}>
        <table className="fabric-table" style={{ width: '100%', textAlign: 'left' }}>
          <thead>
            <tr>
              {['Job', 'Item / part', 'Stage', 'Status', 'Started', 'Completed', 'Attempt'].map(
                (label) => (
                  <th key={label}>{label}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map(({ task, job }) => (
              <tr key={job.id}>
                <td>
                  <button onClick={() => setSelected(job.id)}>{job.code}</button>
                </td>
                <td>
                  {task.style} / {task.part}
                </td>
                <td>{job.stage}</td>
                <td>{job.status}</td>
                <td>{job.started || '—'}</td>
                <td>{job.completed || '—'}</td>
                <td>
                  {job.id === task.currentJobId
                    ? 'Current'
                    : task.path.includes(job.id)
                      ? 'Previous'
                      : 'Historical branch'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && <p>No matching job records.</p>}
      {detail && (
        <dialog
          ref={dialog}
          className="fabric-dialog lab-record-table-wrap"
          onCancel={() => setSelected(null)}
          aria-modal="true"
          aria-labelledby="job-history-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            width: 'min(800px,90vw)',
            maxHeight: '85vh',
            overflow: 'auto',
            borderRadius: 16,
            padding: 24,
            boxShadow: '0 0 0 100vmax #10182866',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setSelected(null);
          }}
        >
          <header className="fabric-page-header">
            <div>
              <h2 id="job-history-title">{detail.job.code}</h2>
              <p>
                {detail.task.style} / {detail.task.part} · {detail.job.stage}
              </p>
            </div>
            <button autoFocus onClick={() => setSelected(null)}>
              Close
            </button>
          </header>
          <p>
            {detail.job.status} ·{' '}
            {detail.job.id === detail.task.currentJobId ? 'Current attempt' : 'Historical attempt'}
          </p>
          <h3>Recorded pieces</h3>
          <table style={{ width: '100%', textAlign: 'left' }}>
            <thead>
              <tr>
                <th>Variant</th>
                <th>Size</th>
                <th>Incoming</th>
                <th>Output</th>
              </tr>
            </thead>
            <tbody>
              {pieces.map((p) => {
                const link = links.find((v) => v.id === p.variant_item_per_job_id);
                const variant = data.variant_item.find((v) => v.id === link?.variant_item_id);
                const size = data.item_size_list.find((s) => s.id === p.item_size_list_id);
                return (
                  <tr key={p.id}>
                    <td>
                      {data.variant.find((v) => v.id === variant?.variant_id)?.variant_name || '—'}
                    </td>
                    <td>{data.size_list.find((s) => s.id === size?.size_list_id)?.size || '—'}</td>
                    <td>{p.pieces_stock_in ?? '—'}</td>
                    <td>{p.pieces_stock_out ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!pieces.length && <p>No piece quantities recorded for this attempt.</p>}
          <h3>Handovers</h3>
          {handovers.length ? (
            handovers.map((h) => (
              <p key={h.visit}>
                {h.employee} → {h.destination} ·{' '}
                {h.pieces.reduce((n, p) => n + Number(p.output), 0)} pieces
              </p>
            ))
          ) : (
            <p>No recorded handover. Legacy verifier information is not treated as a transition.</p>
          )}
          <p>
            Job identities and linked challans are preserved. History cannot move or rewrite a
            stage.
          </p>
        </dialog>
      )}
    </section>
  );
}
