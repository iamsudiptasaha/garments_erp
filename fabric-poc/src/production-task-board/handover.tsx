import Select from 'react-select';
import { useRef, useState } from 'react';
import { ArrowRight, Check, Package } from 'lucide-react';
import {
  people as defaultPeople,
  stages as defaultStages,
  type Task,
  handoverRows,
  completeHandover,
  type PieceEntry,
} from './model';

export function TaskHandover({
  task,
  tasks,
  destination,
  onTask,
  onSubmit,
  readOnly = false,
}: {
  task: Task;
  tasks?: Task[];
  destination?: string;
  onTask?: (id: string) => void;
  onSubmit: (task: Task) => void | Promise<void>;
  readOnly?: boolean;
}) {
  const stages = task.stageOptions || defaultStages;
  const tracked = !task.untrackedStages?.includes(task.stage);
  const people = (task.employeeNames || defaultPeople.map((p) => p.name)).map((name) => ({ name }));
  const [rows, setRows] = useState<PieceEntry[]>(() => handoverRows(task));
  const [next, setNext] = useState(destination || stages[stages.indexOf(task.stage) + 1] || '');
  const [employee, setEmployee] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const submitted = useRef(false);
  const priorStages = task.path
    .filter((id) => id !== task.currentJobId)
    .map((id) => task.attempts.find((a) => a.id === id)!.stage);
  const rectify = stages.indexOf(next) < stages.indexOf(task.stage);
  const filled = rows.filter(
    (r) => r.output !== '' && Number.isSafeInteger(Number(r.output)) && Number(r.output) >= 0,
  ).length;
  const ready =
    (rows.length > 0 || !!task.untrackedStages?.includes(task.stage)) &&
    filled === rows.length &&
    !!employee &&
    !!next &&
    (!rectify || !!reason.trim());
  if (done)
    return (
      <section className="handover-success" role="status">
        <Check size={42} />
        <h2>Handed over</h2>
        <p>
          {task.style} · {task.part} moved to {next}.
        </p>
        <p>
          {tracked
            ? 'All variant quantities are recorded. This handover is complete.'
            : 'Stage handover is recorded. No piece counts are required for this stage.'}
        </p>
      </section>
    );
  return (
    <form
      className="handover-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (readOnly || !ready || submitted.current) return;
        try {
          const updated = completeHandover(task, rows, next, employee, reason);
          submitted.current = true;
          setBusy(true);
          await onSubmit(updated);
          setDone(true);
        } catch (cause) {
          submitted.current = false;
          setError((cause as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="operator-intro">
        <span className="operator-icon">
          <Package size={24} />
        </span>
        <div>
          <span className="eyebrow">PRODUCTION · UPDATE TASK STATUS</span>
          <h2>
            {tracked ? 'Count. Select your name. Hand over.' : 'Select your name. Hand over.'}
          </h2>
          <p>
            {tracked
              ? 'Enter every size for every variant. Use 0 when there are no pieces.'
              : 'This stage does not track pieces. Existing size quantities carry forward.'}
          </p>
        </div>
      </div>
      {tasks && onTask && (
        <label className="operator-field">
          Design / task
          <Select
            unstyled
            className="operator-design-picker"
            inputId="operator-design-task"
            aria-label="Design / task"
            classNamePrefix="operator-design"
            isSearchable
            options={tasks.map((t) => ({
              value: t.id,
              label: `${t.style} · ${t.name} · ${t.stage}`,
            }))}
            value={{ value: task.id, label: `${task.style} · ${task.name} · ${task.stage}` }}
            onChange={(option) => {
              if (option) onTask(option.value);
            }}
            placeholder="Type a design, task or stage…"
            noOptionsMessage={() => 'No matching tasks'}
          />
        </label>
      )}
      <div className="operator-context">
        <div>
          <small>DESIGN / PART</small>
          <strong>
            {task.style} · {task.part}
          </strong>
          <span>{task.name}</span>
        </div>
        <div>
          <small>CURRENT STAGE</small>
          <strong>{task.stage}</strong>
          <span>{tracked ? 'Record pieces leaving this stage' : 'No piece entry required'}</span>
        </div>
      </div>
      <div className="operator-step">
        <b>1</b>
        <div>
          <h3>{tracked ? 'Enter finished pieces' : 'No quantities required'}</h3>
          <p>
            {tracked
              ? 'Sizes and incoming quantities are carried forward. Unequal totals are allowed.'
              : 'Continue below to select the receiving stage and your name.'}
          </p>
        </div>
        <span>
          {filled} / {rows.length} filled
        </span>
      </div>
      {[...new Set(rows.map((r) => r.variant))].map((variant) => (
        <section className="variant-entry" key={variant}>
          <header>
            <strong>{variant}</strong>
            <span>All sizes required</span>
          </header>
          <div className="size-entry-grid">
            {rows.map(
              (row, index) =>
                row.variant === variant && (
                  <label key={row.size}>
                    <strong>{row.size}</strong>
                    <small>In: {row.incoming}</small>
                    <input
                      aria-label={`${variant} ${row.size} pieces`}
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      required
                      placeholder="—"
                      value={row.output}
                      onChange={(e) =>
                        setRows((all) =>
                          all.map((r, i) => (i === index ? { ...r, output: e.target.value } : r)),
                        )
                      }
                    />
                  </label>
                ),
            )}
          </div>
        </section>
      ))}
      <div className="operator-step">
        <b>2</b>
        <div>
          <h3>Choose where it goes</h3>
          <p>Choose the stage receiving these pieces.</p>
        </div>
      </div>
      <label className="operator-field">
        Next stage
        <select
          aria-label="Next stage"
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
        >
          <option value="">Choose a stage…</option>
          {stages
            .filter((stage, i) => i > stages.indexOf(task.stage) || priorStages.includes(stage))
            .map((stage) => (
              <option key={stage}>{stage}</option>
            ))}
        </select>
      </label>
      {rectify && (
        <label className="operator-field">
          Why return to this stage?
          <textarea
            aria-label="Rectification reason"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}
      <div className="operator-step">
        <b>3</b>
        <div>
          <h3>Select your name</h3>
          <p>Your name will be recorded with this handover.</p>
        </div>
      </div>
      <label className="operator-field">
        Handed over by
        <select
          aria-label="Handed over by"
          required
          value={employee}
          onChange={(e) => setEmployee(e.target.value)}
        >
          <option value="">Select your name…</option>
          {people.map((p) => (
            <option key={p.name}>{p.name}</option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      <footer className="operator-submit">
        <p>
          {tracked
            ? 'One handover only. Complete every variant before moving.'
            : 'One handover only. Select your name before moving.'}
        </p>
        <button className="primary-button" type="submit" disabled={readOnly || !ready || busy}>
          Hand over{next && ` to ${next}`}
          <ArrowRight size={18} />
        </button>
      </footer>
    </form>
  );
}
