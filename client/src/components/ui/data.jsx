import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge, Skeleton } from './primitives.jsx';
import { CONDITION_META, MAINTENANCE_STATUS_META, STATUS_META } from '../../lib/constants.js';
import { cx, titleCase } from '../../lib/format.js';

/** The printed-label chip. Every asset id in the app renders through this. */
export function AssetTag({ value, className }) {
  if (!value) return <span className="text-faint">—</span>;
  return <span className={cx('asset-tag', className)}>{value}</span>;
}

export function StatusPill({ value }) {
  const meta = STATUS_META[value] || { label: titleCase(value || ''), tone: 'neutral' };
  return <Badge tone={meta.tone} dot>{meta.label}</Badge>;
}

export function ConditionPill({ value }) {
  if (!value) return <span className="text-faint">—</span>;
  const meta = CONDITION_META[value] || { label: titleCase(value), tone: 'neutral' };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function JobStatusPill({ value }) {
  const meta = MAINTENANCE_STATUS_META[value] || { label: titleCase(value || ''), tone: 'neutral' };
  return <Badge tone={meta.tone} dot>{meta.label}</Badge>;
}

/**
 * One data set, two shapes: a dense sortable table from `sm` up, and a stack
 * of cards on phones. Columns declare both, so pages define data once.
 */
export function DataTable({
  columns, rows, keyField = '_id', loading, empty,
  onRowClick, sort, onSortChange, selected, onSelectedChange, mobileCard,
}) {
  const selectable = Boolean(onSelectedChange);
  const allSelected = selectable && rows.length > 0 && rows.every((r) => selected?.includes(r[keyField]));

  const toggleAll = () => {
    onSelectedChange(allSelected ? [] : rows.map((r) => r[keyField]));
  };
  const toggleOne = (id) => {
    onSelectedChange(selected?.includes(id) ? selected.filter((s) => s !== id) : [...(selected || []), id]);
  };

  const nextSort = (field) => {
    if (!onSortChange) return;
    onSortChange(sort === field ? `-${field}` : sort === `-${field}` ? field : field);
  };

  if (loading) {
    return (
      <div className="divide-y divide-line">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-4">
            <Skeleton className="w-24" />
            <Skeleton className="w-1/3" />
            <Skeleton className="hidden w-24 sm:block" />
            <Skeleton className="ml-auto hidden w-20 sm:block" />
          </div>
        ))}
      </div>
    );
  }

  if (!rows.length) return empty;

  return (
    <>
      {/* Desktop / tablet */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-raised">
              {selectable && (
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox" checked={allSelected} onChange={toggleAll}
                    aria-label="Select all rows on this page"
                    className="h-4 w-4 rounded border-line accent-[rgb(var(--brand))]"
                  />
                </th>
              )}
              {columns.map((col) => {
                const active = sort === col.field || sort === `-${col.field}`;
                return (
                  <th
                    key={col.key || col.field || col.header}
                    className={cx(
                      'whitespace-nowrap px-3 py-2.5 text-left align-middle',
                      'text-eyebrow font-mono font-medium uppercase text-faint',
                      col.align === 'right' && 'text-right',
                      col.className
                    )}
                  >
                    {col.field && onSortChange ? (
                      <button
                        type="button" onClick={() => nextSort(col.field)}
                        className={cx('inline-flex items-center gap-1 hover:text-ink', active && 'text-ink')}
                      >
                        {col.header}
                        <span aria-hidden className="text-[0.6rem]">
                          {active ? (sort.startsWith('-') ? '↓' : '↑') : '↕'}
                        </span>
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr
                key={row[keyField]}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cx('bg-surface transition-colors hover:bg-raised', onRowClick && 'cursor-pointer')}
              >
                {selectable && (
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected?.includes(row[keyField]) || false}
                      onChange={() => toggleOne(row[keyField])}
                      aria-label="Select row"
                      className="h-4 w-4 rounded border-line accent-[rgb(var(--brand))]"
                    />
                  </td>
                )}
                {columns.map((col) => (
                  <td
                    key={col.key || col.field || col.header}
                    className={cx('px-3 py-2.5 align-middle', col.align === 'right' && 'text-right tabular', col.cellClassName)}
                  >
                    {col.render ? col.render(row) : row[col.field] ?? <span className="text-faint">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones */}
      <ul className="divide-y divide-line sm:hidden">
        {rows.map((row) => (
          <li key={row[keyField]}>
            <button
              type="button"
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className="w-full px-4 py-3.5 text-left transition-colors active:bg-raised"
            >
              {mobileCard ? mobileCard(row) : (
                <div className="space-y-1">
                  {columns.slice(0, 3).map((col) => (
                    <div key={col.key || col.field} className="text-sm">
                      {col.render ? col.render(row) : row[col.field]}
                    </div>
                  ))}
                </div>
              )}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Pagination({ meta, onPageChange, className }) {
  if (!meta || meta.pages <= 1) {
    return meta?.total ? (
      <p className={cx('px-4 py-3 text-xs text-muted tabular', className)}>{meta.total} record(s)</p>
    ) : null;
  }
  const { page, pages, total, limit } = meta;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);

  return (
    <div className={cx('flex items-center justify-between gap-3 border-t border-line px-4 py-3', className)}>
      <p className="text-xs text-muted tabular">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-2 text-xs text-ink disabled:opacity-40"
        >
          <ChevronLeft size={14} /> Prev
        </button>
        <span className="px-2 font-mono text-xs text-muted tabular">{page} / {pages}</span>
        <button
          type="button" onClick={() => onPageChange(page + 1)} disabled={page >= pages}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-2 text-xs text-ink disabled:opacity-40"
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
