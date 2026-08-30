import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Download, Play, Settings2, Sliders, Table2,
} from 'lucide-react';
import {
  Badge, Button, Card, Checkbox, EmptyState, Field, SectionHeader, Select, Skeleton, Spinner,
} from '../components/ui/primitives.jsx';
import { Can } from '../components/Can.jsx';
import { useApi } from '../hooks/useApi.js';
import { useToast } from '../context/ToastContext.jsx';
import { api, downloadPost } from '../lib/api.js';
import { P, STATUSES, STATUS_META } from '../lib/constants.js';
import { cx, date as fmtDate, money } from '../lib/format.js';

const BLANK_SPEC = {
  groupBy: ['site'],
  measures: ['count', 'checkedOut', 'available'],
  filters: {},
  sort: { by: 'count', dir: 'desc' },
};

function cell(value, type) {
  if (value === null || value === undefined || value === '') return <span className="text-faint">—</span>;
  if (type === 'money') return money(value);
  if (type === 'date') return fmtDate(value);
  if (type === 'number') return <span className="tabular">{value}</span>;
  return value;
}

/** Renders whatever columns the server described, with a totals row. */
function ResultTable({ result, running }) {
  if (running) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 rounded-md" />)}
      </div>
    );
  }
  if (!result) {
    return (
      <EmptyState
        icon={Table2} title="Nothing run yet"
        description="Pick a prebuilt report, or build your own below."
      />
    );
  }
  if (!result.rows.length) {
    return (
      <EmptyState
        icon={Table2} title="No rows matched"
        description="Loosen the filters and run it again."
      />
    );
  }

  const { columns, rows, totals } = result;
  const numeric = columns.filter((c) => c.type !== 'text');

  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-raised">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cx(
                    'whitespace-nowrap px-3 py-2.5 text-eyebrow font-mono uppercase text-faint',
                    c.type === 'text' ? 'text-left' : 'text-right'
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-raised">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cx('px-3 py-2', c.type === 'text' ? 'text-ink' : 'text-right tabular text-ink')}
                  >
                    {cell(row[c.key], c.type)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {totals && numeric.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-line bg-raised font-medium">
                {columns.map((c, i) => (
                  <td key={c.key} className={cx('px-3 py-2.5', c.type === 'text' ? 'text-ink' : 'text-right tabular text-ink')}>
                    {i === 0 ? 'Total' : c.type === 'text' ? '' : cell(totals[c.key], c.type)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Phones: one card per row, dimensions on top, measures as chips. */}
      <ul className="divide-y divide-line sm:hidden">
        {rows.map((row, i) => (
          <li key={i} className="px-4 py-3">
            <p className="font-medium text-ink">
              {columns.filter((c) => c.type === 'text').map((c) => row[c.key] || '—').join(' · ')}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {numeric.map((c) => (
                <span key={c.key} className="rounded border border-line bg-raised px-1.5 py-0.5 text-xs text-muted">
                  {c.label} <span className="font-mono text-ink">{c.type === 'money' ? money(row[c.key]) : row[c.key] ?? 0}</span>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function Builder({ catalog, spec, onChange, onRun, running }) {
  const lookups = {
    categories: useApi('/lookups/categories').data?.items || [],
    sites: useApi('/lookups/sites').data?.items || [],
    departments: useApi('/lookups/departments').data?.items || [],
  };

  const toggleMeasure = (key) => {
    const has = spec.measures.includes(key);
    // Always leave at least one measure, or the report has nothing to show.
    if (has && spec.measures.length === 1) return;
    onChange({
      ...spec,
      measures: has ? spec.measures.filter((m) => m !== key) : [...spec.measures, key],
    });
  };

  const setGroup = (index, value) => {
    const next = [...spec.groupBy];
    if (!value) next.splice(index, 1);
    else next[index] = value;
    onChange({ ...spec, groupBy: next.length ? next : ['status'] });
  };

  const setFilter = (key, value) => {
    const filters = { ...spec.filters };
    if (!value) delete filters[key];
    else filters[key] = value;
    onChange({ ...spec, filters });
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Sliders size={16} className="text-muted" />
          <h3 className="text-sm font-semibold text-ink">Build your own</h3>
        </div>
        <Button variant="primary" size="sm" icon={Play} onClick={onRun} loading={running}>Run</Button>
      </div>

      <div className="space-y-5 p-4">
        <div>
          <p className="eyebrow mb-2">Group rows by</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Select
                key={i}
                value={spec.groupBy[i] || ''}
                onChange={(e) => setGroup(i, e.target.value)}
                aria-label={`Grouping level ${i + 1}`}
              >
                <option value="">{i === 0 ? 'Choose a field' : '— none —'}</option>
                {catalog.dimensions.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </Select>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">Up to three levels. Leave the later ones empty for a flat report.</p>
        </div>

        <div>
          <p className="eyebrow mb-2">Show these numbers</p>
          <div className="grid gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
            {catalog.measures.map((m) => (
              <Checkbox
                key={m.key}
                label={m.label}
                checked={spec.measures.includes(m.key)}
                onChange={() => toggleMeasure(m.key)}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="eyebrow mb-2">Only include</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Status">
              <Select
                value={spec.filters.status?.[0] || ''}
                onChange={(e) => setFilter('status', e.target.value ? [e.target.value] : null)}
              >
                <option value="">Any status</option>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </Select>
            </Field>
            <Field label="Site">
              <Select value={spec.filters.site || ''} onChange={(e) => setFilter('site', e.target.value)}>
                <option value="">All sites</option>
                {lookups.sites.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Category">
              <Select value={spec.filters.category || ''} onChange={(e) => setFilter('category', e.target.value)}>
                <option value="">All categories</option>
                {lookups.categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Department">
              <Select value={spec.filters.department || ''} onChange={(e) => setFilter('department', e.target.value)}>
                <option value="">All departments</option>
                {lookups.departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Handler" hint="Every site this person looks after.">
              <Select value={spec.filters.handler || ''} onChange={(e) => setFilter('handler', e.target.value)}>
                <option value="">All handlers</option>
                {(catalog.handlers || []).map((h) => <option key={h._id} value={h._id}>{h.name}</option>)}
              </Select>
            </Field>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Sort by">
            <Select
              value={spec.sort?.by || spec.measures[0]}
              onChange={(e) => onChange({ ...spec, sort: { ...spec.sort, by: e.target.value } })}
            >
              {spec.measures.map((key) => {
                const m = catalog.measures.find((x) => x.key === key);
                return <option key={key} value={key}>{m?.label || key}</option>;
              })}
            </Select>
          </Field>
          <Field label="Direction">
            <Select
              value={spec.sort?.dir || 'desc'}
              onChange={(e) => onChange({ ...spec, sort: { ...spec.sort, dir: e.target.value } })}
            >
              <option value="desc">Largest first</option>
              <option value="asc">Smallest first</option>
            </Select>
          </Field>
          <Field label="Include archived">
            <Select
              value={spec.filters.archived ? 'true' : 'false'}
              onChange={(e) => setFilter('archived', e.target.value === 'true' ? true : null)}
            >
              <option value="false">Active records only</option>
              <option value="true">Archived records</option>
            </Select>
          </Field>
        </div>
      </div>
    </Card>
  );
}

export function Reports() {
  const { data: catalog, loading: loadingCatalog } = useApi('/reports');
  const [spec, setSpec] = useState(BLANK_SPEC);
  const [activePreset, setActivePreset] = useState(null);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();

  const runSpec = async (payload, presetKey = null) => {
    setRunning(true);
    try {
      const res = await api.post('/reports/run', payload);
      setResult(res);
      setActivePreset(presetKey);
      // A preset returns the spec it used, so the builder can pick it up.
      if (presetKey && res.spec) {
        setSpec({
          groupBy: res.spec.groupBy || ['status'],
          measures: res.spec.measures || ['count'],
          filters: res.spec.filters || {},
          sort: res.spec.sort || { by: 'count', dir: 'desc' },
        });
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  const exportNow = async (format) => {
    setExporting(true);
    try {
      // A listing preset has no spec to send, so export it by name.
      const body = activePreset && !result?.spec
        ? { preset: activePreset, format }
        : { ...spec, format };
      const stamp = new Date().toISOString().slice(0, 10);
      await downloadPost('/reports/export', body, `${activePreset || 'report'}-${stamp}.${format}`);
      toast.success(`Report exported as .${format}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setExporting(false);
    }
  };

  const grouped = useMemo(
    () => (catalog?.presets || []).filter((p) => p.kind === 'grouped'),
    [catalog]
  );
  const listings = useMemo(
    () => (catalog?.presets || []).filter((p) => p.kind === 'listing'),
    [catalog]
  );

  if (loadingCatalog) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-card" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        eyebrow="Reporting"
        title="Reports"
        description="Prebuilt views for the questions that come up every month, and a builder for the ones that don't."
        actions={
          result && (
            <Can permission={P.ASSET_EXPORT}>
              <Button icon={Download} onClick={() => exportNow('xlsx')} loading={exporting}>Excel</Button>
              <Button onClick={() => exportNow('csv')} loading={exporting}>CSV</Button>
            </Can>
          )
        }
      />

      {catalog.handlers?.length > 0 && (
        <Card className="flex flex-wrap items-center gap-2 p-3">
          <span className="text-sm font-medium text-ink">Just one handler?</span>
          <span className="text-xs text-muted">Runs a full asset breakdown for their sites only.</span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {catalog.handlers.map((h) => (
              <Button
                key={h._id}
                size="sm"
                variant={spec.filters.handler === h._id ? 'primary' : 'secondary'}
                onClick={() => {
                  const next = {
                    groupBy: ['site', 'category'],
                    measures: ['count', 'available', 'checkedOut', 'underRepair', 'disposed'],
                    filters: { handler: h._id },
                    sort: { by: 'count', dir: 'desc' },
                  };
                  setSpec(next);
                  runSpec(next, null);
                }}
              >
                {h.name}
              </Button>
            ))}
            {spec.filters.handler && (
              <Button
                size="sm" variant="ghost"
                onClick={() => {
                  const next = { ...spec, filters: { ...spec.filters, handler: undefined } };
                  delete next.filters.handler;
                  setSpec(next);
                  runSpec(next, null);
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </Card>
      )}

      <Card>
        <div className="border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-muted" />
            <h3 className="text-sm font-semibold text-ink">Ready to run</h3>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Running one also loads it into the builder, so you can adjust rather than start over.
          </p>
        </div>

        <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {grouped.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => runSpec({ preset: p.key }, p.key)}
              className={cx(
                'rounded-md border p-3 text-left transition-colors',
                activePreset === p.key ? 'border-brand bg-brand-soft' : 'border-line hover:bg-raised'
              )}
            >
              <p className={cx('text-sm font-medium', activePreset === p.key ? 'text-brand' : 'text-ink')}>
                {p.label}
              </p>
              <p className="mt-0.5 text-xs leading-snug text-muted">{p.blurb}</p>
            </button>
          ))}
        </div>

        <div className="border-t border-line px-3 pb-3 pt-3">
          <p className="eyebrow mb-2 px-1">Detailed listings</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {listings.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => runSpec({ preset: p.key }, p.key)}
                className={cx(
                  'rounded-md border p-3 text-left transition-colors',
                  activePreset === p.key ? 'border-brand bg-brand-soft' : 'border-line hover:bg-raised'
                )}
              >
                <p className={cx('text-sm font-medium', activePreset === p.key ? 'text-brand' : 'text-ink')}>
                  {p.label}
                </p>
                <p className="mt-0.5 text-xs leading-snug text-muted">{p.blurb}</p>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">
              {activePreset
                ? (catalog.presets.find((p) => p.key === activePreset)?.label || 'Result')
                : 'Result'}
            </h3>
            {result && (
              <p className="mt-0.5 text-xs text-muted">
                {result.rows.length} row(s) · {result.columns.length} column(s)
              </p>
            )}
          </div>
          {running && <Spinner size={16} />}
        </div>
        <ResultTable result={result} running={running} />
      </Card>

      <Builder
        catalog={catalog}
        spec={spec}
        onChange={(next) => { setSpec(next); setActivePreset(null); }}
        onRun={() => runSpec(spec, null)}
        running={running}
      />
    </div>
  );
}
