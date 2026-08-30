import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { History as HistoryIcon, RotateCcw, Search } from 'lucide-react';
import { Button, Card, Field, IconButton, Input, Select } from '../components/ui/primitives.jsx';
import { Pagination } from '../components/ui/data.jsx';
import { HistoryTrail } from '../components/HistoryTrail.jsx';
import { useApi, useDebounced } from '../hooks/useApi.js';
import { ACTION_LABELS } from '../lib/constants.js';

const ENTITIES = ['Asset', 'User', 'Maintenance', 'Category', 'Location', 'Vendor', 'System'];

export function History() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') || '');
  const debounced = useDebounced(search, 300);

  const page = Number(params.get('page') || 1);
  const entity = params.get('entity') || '';
  const action = params.get('action') || '';
  const from = params.get('from') || '';
  const to = params.get('to') || '';

  const query = useMemo(
    () => ({ search: debounced, entity, action, from, to, page, limit: 40 }),
    [debounced, entity, action, from, to, page]
  );

  const { data, loading } = useApi('/audit', query);
  const { data: actions } = useApi('/audit/actions');

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (!v) next.delete(k); else next.set(k, v); }
    if (!('page' in patch)) next.set('page', '1');
    setParams(next, { replace: true });
  };

  const filtersOn = Boolean(entity || action || from || to || debounced);

  return (
    <div className="space-y-4">
      <div>
        <p className="eyebrow mb-1">Audit trail</p>
        <h1 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
          History{data?.meta?.total != null && <span className="ml-2 font-mono text-base font-medium text-faint tabular">{data.meta.total}</span>}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Append-only. Every entry records who acted, what changed, and what the value was before.
        </p>
      </div>

      <Card className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative sm:col-span-2">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={search} onChange={(e) => { setSearch(e.target.value); setParam({ search: e.target.value }); }}
            placeholder="Search asset, person or action" className="pl-9" aria-label="Search history"
          />
        </div>

        <Select value={entity} onChange={(e) => setParam({ entity: e.target.value })} aria-label="Record type">
          <option value="">All record types</option>
          {ENTITIES.map((en) => <option key={en} value={en}>{en}</option>)}
        </Select>

        <Select value={action} onChange={(e) => setParam({ action: e.target.value })} aria-label="Action">
          <option value="">All actions</option>
          {(actions?.actions || []).map((a) => (
            <option key={a} value={a}>{ACTION_LABELS[a] || a}</option>
          ))}
        </Select>

        <div className="flex items-center gap-2">
          <Input type="date" value={from} onChange={(e) => setParam({ from: e.target.value })} aria-label="From date" />
          <Input type="date" value={to} onChange={(e) => setParam({ to: e.target.value })} aria-label="To date" />
          {filtersOn && (
            <IconButton
              label="Clear filters" icon={RotateCcw}
              onClick={() => { setSearch(''); setParam({ search: '', entity: '', action: '', from: '', to: '' }); }}
            />
          )}
        </div>
      </Card>

      <Card>
        <div className="px-4 py-2">
          {loading ? (
            <div className="space-y-3 py-4">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-12 rounded-md" />)}
            </div>
          ) : (
            <HistoryTrail
              entries={data?.items}
              emptyIcon={HistoryIcon}
              emptyTitle={filtersOn ? 'Nothing matches those filters' : 'No activity recorded yet'}
            />
          )}
        </div>
        <Pagination meta={data?.meta} onPageChange={(p) => setParam({ page: p })} />
      </Card>
    </div>
  );
}
