import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Archive, Boxes, Download, Filter, Plus, RotateCcw, Search, Upload, X,
} from 'lucide-react';
import {
  Badge, Button, Card, Checkbox, EmptyState, Field, IconButton, Input, Select,
} from '../components/ui/primitives.jsx';
import { Drawer, Modal } from '../components/ui/overlays.jsx';
import { AssetTag, ConditionPill, DataTable, Pagination, StatusPill } from '../components/ui/data.jsx';
import { Can } from '../components/Can.jsx';
import { useApi, useDebounced } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api, downloadFile } from '../lib/api.js';
import { CONDITIONS, ENTITIES, P, STATUS_META, STATUSES } from '../lib/constants.js';
import { cx, date, daysUntil, titleCase } from '../lib/format.js';

const EMPTY_FILTERS = {
  status: '', condition: '', category: '', site: '', department: '',
  entity: '', warranty: '', assignedTo: '', archived: '',
};

function FilterPanel({ open, onClose, value, onChange, lookups }) {
  const [draft, setDraft] = useState(value);

  const apply = () => { onChange(draft); onClose(); };
  const clear = () => {
    const empty = {
      status: '', condition: '', category: '', site: '', department: '',
      entity: '', warranty: '', assignedTo: '', archived: '',
    };
    setDraft(empty);
    onChange(empty);
    onClose();
  };

  return (
    <Drawer
      open={open} onClose={onClose} title="Filter assets"
      footer={
        <>
          <Button variant="ghost" onClick={clear}>Clear all</Button>
          <Button variant="primary" onClick={apply}>Show results</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Status">
          <Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
            <option value="">Any status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </Select>
        </Field>

        <Field label="Condition">
          <Select value={draft.condition} onChange={(e) => setDraft({ ...draft, condition: e.target.value })}>
            <option value="">Any condition</option>
            {CONDITIONS.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
          </Select>
        </Field>

        <Field label="Category">
          <Select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
            <option value="">All categories</option>
            {lookups.categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </Select>
        </Field>

        <Field label="Site">
          <Select value={draft.site} onChange={(e) => setDraft({ ...draft, site: e.target.value })}>
            <option value="">All sites</option>
            {lookups.sites.map((l) => (
              <option key={l._id} value={l._id}>{l.name}{l.city ? ` — ${l.city}` : ''}</option>
            ))}
          </Select>
        </Field>

        <Field label="Department">
          <Select value={draft.department} onChange={(e) => setDraft({ ...draft, department: e.target.value })}>
            <option value="">All departments</option>
            {lookups.departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
          </Select>
        </Field>

        <Field label="Owning company" hint="Read from the tag prefix.">
          <Select value={draft.entity} onChange={(e) => setDraft({ ...draft, entity: e.target.value })}>
            <option value="">All companies</option>
            {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
          </Select>
        </Field>

        <Field label="Warranty">
          <Select value={draft.warranty} onChange={(e) => setDraft({ ...draft, warranty: e.target.value })}>
            <option value="">Any</option>
            <option value="expiring">Expiring within 30 days</option>
            <option value="expired">Already expired</option>
          </Select>
        </Field>

        <Field label="Held by">
          <Select value={draft.assignedTo} onChange={(e) => setDraft({ ...draft, assignedTo: e.target.value })}>
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="unassigned">Nobody (in stock)</option>
          </Select>
        </Field>

        <Field label="Archive">
          <Select value={draft.archived} onChange={(e) => setDraft({ ...draft, archived: e.target.value })}>
            <option value="">Active records</option>
            <option value="true">Archived records</option>
          </Select>
        </Field>
      </div>
    </Drawer>
  );
}

function BulkBar({ count, onClear, onApply, lookups }) {
  const [patch, setPatch] = useState({});
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try { await onApply(patch); setPatch({}); } finally { setBusy(false); }
  };

  return (
    <Card className="sticky bottom-20 z-30 flex flex-wrap items-center gap-2 border-brand/40 p-3 sm:bottom-4">
      <Badge tone="brand">{count} selected</Badge>
      <Select
        className="h-9 w-auto min-w-[9rem]" value={patch.status || ''}
        onChange={(e) => setPatch({ ...patch, status: e.target.value || undefined })}
      >
        <option value="">Set status…</option>
        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
      </Select>
      <Select
        className="h-9 w-auto min-w-[9rem]" value={patch.site || ''}
        onChange={(e) => setPatch({ ...patch, site: e.target.value || undefined })}
      >
        <option value="">Move to site…</option>
        {lookups.sites.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
      </Select>
      <Select
        className="h-9 w-auto min-w-[9rem]" value={patch.department || ''}
        onChange={(e) => setPatch({ ...patch, department: e.target.value || undefined })}
      >
        <option value="">Set department…</option>
        {lookups.departments.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
      </Select>
      <Button variant="primary" size="sm" onClick={run} loading={busy} disabled={!Object.keys(patch).length}>
        Apply to {count}
      </Button>
      <Button variant="ghost" size="sm" icon={X} onClick={onClear}>Clear</Button>
    </Card>
  );
}

export function Assets() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') || '');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState([]);
  const [importOpen, setImportOpen] = useState(false);
  const debounced = useDebounced(search, 300);
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();

  const filters = useMemo(() => ({
    status: params.get('status') || '',
    condition: params.get('condition') || '',
    category: params.get('category') || '',
    site: params.get('site') || '',
    department: params.get('department') || '',
    entity: params.get('entity') || '',
    warranty: params.get('warranty') || '',
    assignedTo: params.get('assignedTo') || '',
    archived: params.get('archived') || '',
  }), [params]);

  const page = Number(params.get('page') || 1);
  const sort = params.get('sort') || '-createdAt';

  const query = useMemo(() => ({
    ...filters, search: debounced, page, sort, limit: 25,
  }), [filters, debounced, page, sort]);

  const { data, loading, reload } = useApi('/assets', query);
  const { data: categories } = useApi('/lookups/categories', undefined, { enabled: can(P.LOOKUP_READ) });
  const { data: sites } = useApi('/lookups/sites', undefined, { enabled: can(P.LOOKUP_READ) });
  const { data: departments } = useApi('/lookups/departments', undefined, { enabled: can(P.LOOKUP_READ) });

  const lookups = {
    categories: categories?.items || [],
    sites: sites?.items || [],
    departments: departments?.items || [],
  };

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v === undefined || v === null) next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.set('page', '1');
    setParams(next, { replace: true });
  };

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const bulkApply = async (patch) => {
    try {
      const res = await api.post('/assets/bulk', { ids: selected, patch });
      toast.success(res.message);
      setSelected([]);
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const [exportOpen, setExportOpen] = useState(false);

  const columns = [
    { key: 'tag', header: 'Tag', field: 'tag', render: (r) => <AssetTag value={r.tag} /> },
    {
      key: 'name', header: 'Asset', field: 'name',
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{r.name}</p>
          <p className="truncate text-xs text-muted">
            {[r.brand, r.model].filter(Boolean).join(' ') || r.category?.name || '—'}
          </p>
        </div>
      ),
    },
    { key: 'serial', header: 'Serial', render: (r) => <span className="font-mono text-xs text-muted">{r.serialNumber || '—'}</span> },
    { key: 'status', header: 'Status', field: 'status', render: (r) => <StatusPill value={r.status} /> },
    { key: 'condition', header: 'Condition', render: (r) => <ConditionPill value={r.condition} /> },
    {
      key: 'holder', header: 'Held by',
      render: (r) => (r.assignedTo || r.assignedToLabel ? (
        <div className="min-w-0">
          <p className="truncate text-sm text-ink">
            {r.assignedTo?.name || r.assignedToLabel}
            {!r.assignedTo && r.assignedToLabel && (
              <span className="ml-1 text-xs font-normal text-faint" title="No matching account">unlinked</span>
            )}
          </p>
          {r.dueAt && (
            <p className={`truncate text-xs ${daysUntil(r.dueAt) < 0 ? 'text-danger' : 'text-muted'}`}>
              due {date(r.dueAt, { year: undefined })}
            </p>
          )}
        </div>
      ) : <span className="text-faint">—</span>),
    },
    {
      key: 'site', header: 'Site',
      render: (r) => (r.site ? (
        <div className="min-w-0">
          <p className="truncate text-sm text-ink">{r.site.name}</p>
          <p className="truncate text-xs text-muted">{r.site.city || ''}</p>
        </div>
      ) : <span className="text-faint">—</span>),
    },
    { key: 'department', header: 'Department', render: (r) => <span className="text-sm text-muted">{r.department?.name || '—'}</span> },
    {
      key: 'handler', header: 'Handler',
      render: (r) => (r.site?.handler
        ? <span className="text-sm text-muted">{r.site.handler.name}</span>
        : <span className="text-faint">—</span>),
    },
  ];

  const mobileCard = (r) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <AssetTag value={r.tag} />
        <StatusPill value={r.status} />
      </div>
      <div>
        <p className="font-medium leading-snug text-ink">{r.name}</p>
        <p className="mt-0.5 text-xs text-muted">
          {[r.brand, r.model, r.serialNumber].filter(Boolean).join(' · ') || '—'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {(r.assignedTo || r.assignedToLabel) && <span>Held by {r.assignedTo?.name || r.assignedToLabel}</span>}
        {r.site?.name && <span>{r.site.name}</span>}
        {r.department?.name && <span>{r.department.name}</span>}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Register</p>
          <h1 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
            Assets{data?.meta?.total != null && <span className="ml-2 font-mono text-base font-medium text-faint tabular">{data.meta.total}</span>}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Can permission={P.ASSET_EXPORT}>
            <Button size="sm" icon={Download} onClick={() => setExportOpen(true)}>Export</Button>
          </Can>
          <Can permission={P.ASSET_IMPORT}>
            <Button size="sm" icon={Upload} onClick={() => setImportOpen(true)}>Import</Button>
          </Can>
          <Can permission={P.ASSET_CREATE}>
            <Link to="/assets/new" className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-xs font-medium text-brand-ink hover:brightness-110">
              <Plus size={15} /> Add asset
            </Link>
          </Can>
        </div>
      </div>

      <Card className="flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-0 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setParam({ search: e.target.value }); }}
            placeholder="Search by tag, name, serial or invoice"
            className="pl-9"
            aria-label="Search assets"
          />
        </div>
        <Button
          icon={Filter} onClick={() => setFiltersOpen(true)}
          className={activeFilterCount ? 'border-brand text-brand' : ''}
        >
          Filters{activeFilterCount > 0 && <span className="ml-1 font-mono">({activeFilterCount})</span>}
        </Button>
        {activeFilterCount > 0 && (
          <IconButton
            label="Clear filters" icon={RotateCcw}
            onClick={() => setParam(EMPTY_FILTERS)}
          />
        )}
      </Card>

      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={data?.items || []}
          loading={loading}
          sort={sort}
          onSortChange={(s) => setParam({ sort: s })}
          selected={can(P.ASSET_UPDATE) ? selected : undefined}
          onSelectedChange={can(P.ASSET_UPDATE) ? setSelected : undefined}
          onRowClick={(r) => navigate(`/assets/${r._id}`)}
          mobileCard={mobileCard}
          empty={
            <EmptyState
              icon={filters.archived ? Archive : Boxes}
              title={search || activeFilterCount ? 'Nothing matches those filters' : 'The register is empty'}
              description={
                search || activeFilterCount
                  ? 'Try a broader search, or clear the filters to see everything.'
                  : 'Add your first asset, or import the spreadsheet you already keep.'
              }
              action={
                search || activeFilterCount ? (
                  <Button onClick={() => { setSearch(''); setParam({ search: '', ...EMPTY_FILTERS }); }}>
                    Clear filters
                  </Button>
                ) : (
                  <Can permission={P.ASSET_IMPORT}>
                    <Button variant="primary" icon={Upload} onClick={() => setImportOpen(true)}>Import a spreadsheet</Button>
                  </Can>
                )
              }
            />
          }
        />
        <Pagination meta={data?.meta} onPageChange={(p) => setParam({ page: p })} />
      </Card>

      {selected.length > 0 && (
        <BulkBar count={selected.length} onClear={() => setSelected([])} onApply={bulkApply} lookups={lookups} />
      )}

      <FilterPanel
        open={filtersOpen} onClose={() => setFiltersOpen(false)}
        value={filters} onChange={setParam} lookups={lookups}
      />

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={reload} />

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} filters={filters} />
    </div>
  );
}

/** Two-step import: read headers and confirm the mapping, then write. */
function ImportDialog({ open, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [mode, setMode] = useState('upsert');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const reset = () => { setFile(null); setPreview(null); setMapping({}); setResult(null); };

  const readFile = async (selected) => {
    setFile(selected);
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', selected);
      const res = await api.post('/data/import/preview', body);
      setPreview(res);
      setMapping(res.suggestedMapping);
    } catch (err) {
      toast.error(err.message);
      setFile(null);
    } finally {
      setBusy(false);
    }
  };

  const commit = async (dryRun) => {
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('mapping', JSON.stringify(mapping));
      body.append('mode', mode);
      body.append('dryRun', String(dryRun));
      const res = await api.post('/data/import/commit', body);
      setResult(res);
      if (!dryRun) {
        toast.success(`Imported ${res.summary.created} new and updated ${res.summary.updated} asset(s)`);
        onDone?.();
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const mappedCount = Object.values(mapping).filter((v) => v !== '__custom__' && v !== '__ignore__').length;

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Import assets from a spreadsheet"
      description="Assets are matched on asset tag. Your column names are matched to fields automatically, and anything unmatched is kept as a custom field."
      size="xl"
      footer={
        preview && !result ? (
          <>
            <Button onClick={reset}>Choose another file</Button>
            <Button onClick={() => commit(true)} loading={busy}>Dry run</Button>
            <Button variant="primary" onClick={() => commit(false)} loading={busy}>
              {mode === 'update' ? 'Update' : 'Import'} {preview.totalRows} row(s)
            </Button>
          </>
        ) : result ? (
          <>
            <Button onClick={reset}>Import another file</Button>
            <Button variant="primary" onClick={() => { reset(); onClose(); }}>Done</Button>
          </>
        ) : (
          <Button onClick={onClose}>Cancel</Button>
        )
      }
    >
      {!preview && (
        <div className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line bg-raised px-6 py-12 text-center hover:border-brand">
            <Upload size={22} className="text-muted" />
            <span className="text-sm font-medium text-ink">Choose a .xlsx, .xls or .csv file</span>
            <span className="text-xs text-muted">Up to 12 MB. The first sheet is used unless you pick another.</span>
            <input
              type="file" accept=".xlsx,.xls,.csv" className="sr-only"
              onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
            />
          </label>
          <p className="text-xs text-muted">
            Not sure about the format?{' '}
            <button
              type="button"
              onClick={() => downloadFile('/data/template', undefined, 'asset-import-template.xlsx')}
              className="font-medium text-brand hover:underline"
            >
              Download a blank template
            </button>
            .
          </p>
          {busy && <p className="text-sm text-muted">Reading the file…</p>}
        </div>
      )}

      {preview && !result && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="brand">{preview.totalRows} rows</Badge>
            <Badge tone="steel">{mappedCount} of {preview.headers.length} columns mapped</Badge>
            <span className="text-muted">Sheet: {preview.sheetName}</span>
          </div>

          <Field
            label="What this import should do"
            hint={preview.modes?.[mode]}
          >
            <Select value={mode} onChange={(e) => setMode(e.target.value)} className="sm:w-80">
              <option value="upsert">Add new and update existing</option>
              <option value="create">Only add new assets</option>
              <option value="update">Only update existing assets</option>
            </Select>
          </Field>

          {/* Tag problems make the whole file unusable, so they are shown
              before the mapping table rather than after the import fails. */}
          {preview.tagCheck && (
            <div
              className={cx(
                'rounded-card border p-3',
                preview.tagCheck.blankTagCount || preview.tagCheck.duplicateTagCount
                  ? 'border-danger/40 bg-danger-soft'
                  : 'border-brand/40 bg-brand-soft'
              )}
            >
              <p className="text-sm font-medium text-ink">
                Asset tag column: {preview.tagCheck.column
                  ? <span className="font-mono">{preview.tagCheck.column}</span>
                  : <span className="text-danger">not found</span>}
              </p>
              <p className="mt-1 text-xs text-muted">
                {preview.tagCheck.distinctTags} distinct tag(s) across {preview.totalRows} row(s).
                Assets are matched by tag, so it must be present and unique.
              </p>

              {preview.tagCheck.blankTagCount > 0 && (
                <p className="mt-1.5 text-xs text-danger">
                  {preview.tagCheck.blankTagCount} row(s) have no tag and will be rejected
                  {preview.tagCheck.blankTagRows?.length
                    ? ` — row ${preview.tagCheck.blankTagRows.slice(0, 8).join(', row ')}`
                    : ''}.
                </p>
              )}
              {preview.tagCheck.duplicateTagCount > 0 && (
                <p className="mt-1.5 text-xs text-danger">
                  {preview.tagCheck.duplicateTagCount} tag(s) appear more than once in this file; only the
                  first of each is imported.
                  {preview.tagCheck.duplicateTags?.slice(0, 4).map((d) => ` ${d.tag} (rows ${d.rows.join(' & ')})`).join(';')}
                </p>
              )}
            </div>
          )}

          <div className="overflow-hidden rounded-card border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-raised">
                  <th className="px-3 py-2 text-left text-eyebrow font-mono uppercase text-faint">Your column</th>
                  <th className="px-3 py-2 text-left text-eyebrow font-mono uppercase text-faint">Sample value</th>
                  <th className="px-3 py-2 text-left text-eyebrow font-mono uppercase text-faint">Maps to</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.headers.map((header) => (
                  <tr key={header}>
                    <td className="px-3 py-2 font-medium text-ink">{header}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2 font-mono text-xs text-muted">
                      {String(preview.sample.find((row) => row[header] != null)?.[header] ?? '—')}
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        value={mapping[header] || '__custom__'}
                        onChange={(e) => setMapping({ ...mapping, [header]: e.target.value })}
                        className="h-9"
                      >
                        {preview.fields.map((f) => <option key={f} value={f}>{titleCase(f)}</option>)}
                        <option value="__custom__">Keep as custom field</option>
                        <option value="__ignore__">Ignore this column</option>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ['Created', result.summary.created, 'brand'],
              ['Updated', result.summary.updated, 'steel'],
              ['Custody dates', result.summary.custodyChanges || 0, 'steel'],
              ['Skipped', result.summary.skipped, 'neutral'],
              ['Failed', result.summary.failed, result.summary.failed ? 'danger' : 'neutral'],
            ].map(([label, value, tone]) => (
              <Card key={label} className="p-3">
                <p className="eyebrow">{label}</p>
                <p className="mt-1 font-display text-xl font-bold tabular text-ink">{value}</p>
                <Badge tone={tone} className="mt-1.5">{result.dryRun ? 'dry run' : 'saved'}</Badge>
              </Card>
            ))}
          </div>

          {result.errors?.length > 0 && (
            <div className="rounded-card border border-danger/40 bg-danger-soft p-3">
              <p className="mb-1.5 text-sm font-medium text-ink">Rows that could not be imported</p>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted">
                {result.errors.map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}
              </ul>
            </div>
          )}

          {result.dryRun && (
            <p className="text-sm text-muted">
              Nothing was saved. If those numbers look right, run the import for real.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * Column-aware export. Defaults to the register's own fourteen columns so the
 * file round-trips back into the same spreadsheet, with everything else —
 * including whatever custom fields this database actually holds — opt-in.
 */
function ExportDialog({ open, onClose, filters }) {
  const { data, loading } = useApi('/data/export/fields', undefined, { enabled: open });
  const [selected, setSelected] = useState(null);
  const [customFields, setCustomFields] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // Seed the selection from the register layout once the catalogue arrives.
  useEffect(() => {
    if (data && selected === null) {
      setSelected(data.registerLayout);
      setCustomFields(data.customFields);
    }
  }, [data, selected]);

  const toggle = (key) => {
    setSelected((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  };
  const toggleCustom = (key) => {
    setCustomFields((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  };

  const run = async (format) => {
    setBusy(true);
    try {
      await downloadFile(
        '/data/export',
        {
          ...filters,
          format,
          fields: selected.join(','),
          includeCustomFields: customFields?.length ? 'true' : 'false',
          ...(customFields?.length ? { customFields: customFields.join(',') } : {}),
        },
        `asset-register-${new Date().toISOString().slice(0, 10)}.${format}`
      );
      toast.success(`Export ready as .${format}`);
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const activeFilters = Object.entries(filters).filter(([, v]) => v).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export assets"
      description={
        activeFilters
          ? `Your ${activeFilters} active filter(s) apply to this export.`
          : 'The whole active register will be exported.'
      }
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={() => run('csv')} loading={busy} disabled={!selected?.length}>CSV</Button>
          <Button variant="primary" onClick={() => run('xlsx')} loading={busy} disabled={!selected?.length}>
            Excel
          </Button>
        </>
      }
    >
      {loading || !selected ? (
        <p className="py-6 text-center text-sm text-muted">Loading available columns…</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">{selected.length} column(s)</Badge>
            {customFields?.length > 0 && <Badge tone="steel">{customFields.length} custom field(s)</Badge>}
            <Button size="sm" variant="ghost" onClick={() => setSelected(data.registerLayout)}>
              Reset to register layout
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(data.columns.map((c) => c.key))}>
              Select all
            </Button>
          </div>

          <div>
            <p className="eyebrow mb-2">Register columns</p>
            <p className="mb-2 text-xs text-muted">
              These fourteen match your spreadsheet exactly, in its original order.
            </p>
            <div className="grid gap-1.5 sm:grid-cols-3">
              {data.columns.filter((c) => c.inRegisterLayout).map((c) => (
                <Checkbox
                  key={c.key} label={c.label}
                  checked={selected.includes(c.key)}
                  onChange={() => toggle(c.key)}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="eyebrow mb-2">Extra columns the app tracks</p>
            <div className="grid gap-1.5 sm:grid-cols-3">
              {data.columns.filter((c) => !c.inRegisterLayout).map((c) => (
                <Checkbox
                  key={c.key} label={c.label}
                  checked={selected.includes(c.key)}
                  onChange={() => toggle(c.key)}
                />
              ))}
            </div>
          </div>

          {data.customFields?.length > 0 && (
            <div>
              <p className="eyebrow mb-2">Custom fields found in your data</p>
              <p className="mb-2 text-xs text-muted">
                Columns from earlier imports that had no matching field. They are kept per asset and
                appear after the chosen columns.
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {data.customFields.map((key) => (
                  <Checkbox
                    key={key} label={key}
                    checked={customFields?.includes(key)}
                    onChange={() => toggleCustom(key)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
