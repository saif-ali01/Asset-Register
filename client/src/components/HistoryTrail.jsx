import { ArrowRight } from 'lucide-react';
import { Avatar, EmptyState } from './ui/primitives.jsx';
import { ACTION_LABELS } from '../lib/constants.js';
import { cx, dateTime, relative, titleCase } from '../lib/format.js';

const TONE_BY_PREFIX = [
  [/deleted|archived|lost/, 'bg-danger'],
  [/checked_out|transferred/, 'bg-steel'],
  [/checked_in|created|restored|completed/, 'bg-brand'],
  [/updated|edited|imported/, 'bg-amber'],
];

const dotTone = (action) => TONE_BY_PREFIX.find(([rx]) => rx.test(action))?.[1] || 'bg-faint';

function ChangeRow({ change }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="font-medium text-muted">{change.label || change.field}</span>
      <span className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-faint line-through">
        {change.from ?? 'empty'}
      </span>
      <ArrowRight size={11} className="text-faint" />
      <span className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-ink">
        {change.to ?? 'empty'}
      </span>
    </div>
  );
}

/**
 * Chain of custody, read top-down. The rail is deliberately literal: one
 * node per recorded event, with the field-level diff underneath it.
 */
export function HistoryTrail({ entries, emptyIcon, emptyTitle = 'No history yet', dense }) {
  if (!entries?.length) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} description="Changes will appear here as soon as someone edits this record." />;
  }

  return (
    <ol className="relative space-y-0">
      <span aria-hidden className="absolute bottom-4 left-[7px] top-3 w-px bg-line" />
      {entries.map((entry) => (
        <li key={entry._id} className={cx('relative flex gap-3 pl-0', dense ? 'py-2.5' : 'py-3.5')}>
          <span aria-hidden className={cx('mt-1.5 h-[15px] w-[15px] shrink-0 rounded-full border-2 border-surface', dotTone(entry.action))} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <p className="text-sm font-medium text-ink">
                {ACTION_LABELS[entry.action] || titleCase(entry.action.split('.').pop())}
              </p>
              <span className="font-mono text-xs text-faint" title={dateTime(entry.at)}>
                {relative(entry.at)}
              </span>
            </div>

            {entry.entityLabel && <p className="mt-0.5 truncate text-xs text-muted">{entry.entityLabel}</p>}

            <div className="mt-1.5 flex items-center gap-1.5">
              <Avatar name={entry.actorName || entry.actor?.name || 'System'} src={entry.actor?.avatarUrl} size={18} />
              <span className="text-xs text-muted">
                {entry.actorName || entry.actor?.name || 'System'}
                {entry.actorRole && <span className="text-faint"> · {titleCase(entry.actorRole)}</span>}
              </span>
            </div>

            {entry.changes?.length > 0 && (
              <div className="mt-2 space-y-1 rounded-md border border-line bg-raised p-2">
                {entry.changes.slice(0, 8).map((change, i) => <ChangeRow key={i} change={change} />)}
                {entry.changes.length > 8 && (
                  <p className="text-xs text-faint">+{entry.changes.length - 8} more field(s)</p>
                )}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
