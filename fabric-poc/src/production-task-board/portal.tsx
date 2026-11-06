import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ProductionStudio, type PortalBoardOptions } from './studio';
import { portalTasks, savePortalTasks } from './portal-data';
import styles from './studio.css?inline';
import type { Task } from './model';
import { StartProduction } from './start-production';

// Keep isolated component styles, using the portal palette in portal/floor modes.
const portalPalette: Record<string, string> = {
  '#7862da': '#357fb7',
  '#6c54ca': '#286c9e',
  '#9d89ed': '#7bbcf1',
  '#f1effa': '#edf5fd',
  '#ede4ff': '#e0effd',
  '#8b75dc': '#357fb7',
  '#343746': '#243e53',
  '#9295a5': '#7a90a3',
  '#e9eaf0': '#dce6f0',
  '#f5f5f9': '#edf4fb',
  '#ecebf2': '#dbe6f1',
  '#fcfcfe': '#f8fbfe',
};
const portalStyles = styles
  .replaceAll(':root', ':host')
  .replace(/#[0-9a-f]{6}(?:[0-9a-f]{2})?\b/gi, (color) => {
    const base = color.slice(0, 7).toLowerCase();
    const r = parseInt(base.slice(1, 3), 16),
      g = parseInt(base.slice(3, 5), 16),
      b = parseInt(base.slice(5, 7), 16);
    // Recolour violet surfaces and accents, preserving semantic red/amber/green.
    const blue =
      b > r && r > g && b - g > 12
        ? g > 220
          ? '#edf5fd'
          : g > 180
            ? '#d1e8fa'
            : g > 130
              ? '#7a90a3'
              : '#357fb7'
        : base;
    return (portalPalette[base] || blue) + color.slice(7);
  });
type Props = {
  data: Parameters<typeof portalTasks>[0];
  actor: string;
  mode: 'board' | 'update' | 'floor';
  canEdit: boolean;
  canCreate?: boolean;
  onCreate?: (data: Parameters<typeof portalTasks>[0]) => void;
  onSave: (data: Parameters<typeof portalTasks>[0]) => void;
  live?: boolean;
  liveTasks?: Task[];
  onImage?: (id: string) => Promise<string>;
  onCommit?: (before: Task[], after: Task[]) => Promise<Task[]>;
  onStart?: (part: string, employee: string) => Promise<void>;
};
export function PortalTaskBoard({
  data,
  actor,
  mode,
  canEdit,
  canCreate = false,
  onCreate,
  onSave,
  live,
  liveTasks,
  onCommit,
  onStart,
  onImage,
}: Props) {
  const [starting, setStarting] = useState(false);
  const [generation, setGeneration] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);
  useLayoutEffect(() => {
    if (host.current)
      setShadow(host.current.shadowRoot || host.current.attachShadow({ mode: 'open' }));
  }, []);
  const portal: PortalBoardOptions = {
    tasks: live
      ? (liveTasks || []).map((t) => ({
          ...t,
          resolveImage:
            t.imageAttachmentId && onImage ? () => onImage(t.imageAttachmentId!) : undefined,
        }))
      : portalTasks(data),
    live,
    onCommit,
    actor,
    mode,
    canEdit,
    onSave: (tasks) => onSave(savePortalTasks(data, tasks)),
  };
  return (
    <div ref={host} data-production-workspace="true">
      {shadow &&
        createPortal(
          <>
            <style>
              {portalStyles}
              {`
      :host {display:block; min-width:0; font-family:Inter,system-ui,sans-serif;}
      .studio-shell {grid-template-columns:minmax(0,1fr);height:calc(100dvh - 135px);min-height:620px;}
      .studio-sidebar,.topbar {display:none;}
      .page-heading {padding-top:24px;}
      .operator-page {min-height:0;}
      .operator-page-main {padding-top:20px;}
      .operator-nav {display:none;}
      .operator-page,.handover-form,.operator-field,.operator-context strong,
      .operator-intro h2,.operator-step h3,.size-entry-grid strong,
      .size-entry-grid input,.operator-field select,.operator-field textarea,
      .operator-design__single-value,.operator-design__input-container,
      .operator-design__input-container input,.operator-design__option,
      .variant-entry header strong {color:#243e53;}
      .operator-intro p,.operator-step p,.operator-context span,
      .operator-context small,.operator-step > span,.operator-submit p,
      .variant-entry header span,.size-entry-grid small,
      .operator-page-label span,.handover-form .eyebrow,
      .operator-design__placeholder {color:#6c8598;}
      .operator-page {background:#f8fbfe;}
      .operator-context,.variant-entry header {background:#edf4fb;border-color:#dce6f0;}
      .handover-form,.variant-entry,.operator-submit,
      .operator-field select,.operator-field textarea,.size-entry-grid input,
      .operator-design__control {border-color:#dce6f0;}
      .operator-icon,.operator-step > b {color:#357fb7;background:#e7f2fd;}
      .size-entry-grid input:focus {outline-color:#7bbcf1;border-color:#357fb7;}
      .operator-design__option--is-selected {color:#fff;background:#357fb7;}
      .operator-design__option--is-focused {background:#edf5fd;}

      .studio-modal {max-height:90dvh;}
    `}
            </style>
            {mode === 'board' && canCreate && (
              <div style={{ textAlign: 'right', padding: '10px 20px' }}>
                <button className="primary-button" onClick={() => setStarting(true)}>
                  + Start production
                </button>
              </div>
            )}
            {starting && (
              <StartProduction
                data={data}
                onStart={
                  onStart
                    ? async (part, employee) => {
                        await onStart(part, employee);
                        setStarting(false);
                        setGeneration((v) => v + 1);
                      }
                    : undefined
                }
                onClose={() => setStarting(false)}
                onSave={(next) => {
                  if (!canCreate || !onCreate) return;
                  onCreate(next);
                  setStarting(false);
                  setGeneration((v) => v + 1);
                }}
              />
            )}
            {mode === 'update' && (
              <div style={{ textAlign: 'right', padding: '10px 20px' }}>
                <a
                  href={`/fabric.html?floor=1&task=${encodeURIComponent(portal.tasks[0]?.id || '')}#productionUpdateTaskStatus`}
                >
                  Open standalone floor form ↗
                </a>
              </div>
            )}
            <ProductionStudio key={`${actor}:${mode}:${generation}`} portal={portal} />
          </>,
          shadow,
        )}
    </div>
  );
}
