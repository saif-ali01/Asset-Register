import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, ClipboardList, Undo2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, Select, Textarea } from '../components/ui/primitives.jsx';
import { Modal } from '../components/ui/overlays.jsx';
import { AssetTag, ConditionPill, DataTable, Pagination } from '../components/ui/data.jsx';
import { Can } from '../components/Can.jsx';
import { useApi } from '../hooks/useApi.js';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { CONDITIONS, P } from '../lib/constants.js';
import { date, daysUntil, titleCase } from '../lib/format.js';

const STATES = [
  { value: '', label: 'All records' },
  { value: 'open', label: 'Currently out' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'returned', label: 'Returned' },
];

function ReturnDialog({ entry, onClose, onDone }) {
  const [form, setForm] = useState({ conditionIn: 'good', status: 'available', notesIn: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/assignments/${entry._id}/checkin`, form);
      toast.success(`${entry.asset?.tag} received back`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open onClose={onClose}
      title={`Check in ${entry.asset?.tag}`}
      description={`Returning from ${entry.assignedTo?.name}.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy}>Receive it back</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Condition on return">
            <Select value={form.conditionIn} onChange={(e) => setForm({ ...form, conditionIn: e.target.value })}>
              {CONDITIONS.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </Select>
          </Field>
          <Field label="Where it goes next">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="available">Available again</option>
              <option value="under_repair">Straight to repair</option>
              <option value="leased">Out on lease</option>
              <option value="disposed">Dispose of it</option>
              <option value="lost_missing">Mark as lost or missing</option>
            </Select>
          </Field>
        </div>
        <Field label="Note">
          <Textarea value={form.notesIn} onChange={(e) => setForm({ ...form, notesIn: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

export function Custody() {
  const [params, setParams] = useSearchParams();
  const [returning, setReturning] = useState(null);
  const navigate = useNavigate();

  const state = params.get('state') || '';
  const page = Number(params.get('page') || 1);
  const scope = params.get('assignedTo') || '';

  const query = useMemo(() => ({ state, page, assignedTo: scope, limit: 25 }), [state, page, scope]);
  const { data, loading, reload } = useApi('/assignments', query);

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k); else next.set(k, v);
    }
    if (!('page' in patch)) next.set('page', '1');
    setParams(next, { replace: true });
  };

  const columns = [
    { key: 'tag', header: 'Tag', render: (r) => <AssetTag value={r.asset?.tag} /> },
    {
      key: 'asset', header: 'Asset',
      render: (r) => <p className="truncate font-medium text-ink">{r.asset?.name || '—'}</p>,
    },
    {
      key: 'person', header: 'Held by',
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-ink">{r.assignedTo?.name}</p>
          <p className="truncate text-xs text-muted">{r.assignedTo?.department || r.assignedTo?.email}</p>
        </div>
      ),
    },
    { key: 'out', header: 'Out on', field: 'checkedOutAt', render: (r) => <span className="text-sm text-muted">{date(r.checkedOutAt)}</span> },
    {
      key: 'due', header: 'Due back',
      render: (r) => {
        if (!r.dueAt) return <span className="text-faint">Open-ended</span>;
        const days = daysUntil(r.dueAt);
        if (r.checkedInAt) return <span className="text-sm text-muted">{date(r.dueAt)}</span>;
        return (
          <span className={days < 0 ? 'text-sm font-medium text-danger' : 'text-sm text-muted'}>
            {date(r.dueAt)}{days < 0 && ` · ${Math.abs(days)}d late`}
          </span>
        );
      },
    },
    {
      key: 'state', header: 'State',
      render: (r) => (r.checkedInAt
        ? <Badge tone="neutral">Returned {date(r.checkedInAt, { year: undefined })}</Badge>
        : <Badge tone={r.isOverdue ? 'danger' : 'brand'} dot>{r.isOverdue ? 'Overdue' : 'Out'}</Badge>),
    },
    {
      key: 'actions', header: '', align: 'right',
      render: (r) => (!r.checkedInAt ? (
        <Can permission={P.ASSIGNMENT_CHECKIN}>
          <Button
            size="sm" icon={Undo2}
            onClick={(e) => { e.stopPropagation(); setReturning(r); }}
          >
            Check in
          </Button>
        </Can>
      ) : null),
    },
  ];

  const mobileCard = (r) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <AssetTag value={r.asset?.tag} />
        {r.checkedInAt
          ? <Badge tone="neutral">Returned</Badge>
          : <Badge tone={r.isOverdue ? 'danger' : 'brand'} dot>{r.isOverdue ? 'Overdue' : 'Out'}</Badge>}
      </div>
      <p className="font-medium leading-snug text-ink">{r.asset?.name}</p>
      <p className="text-xs text-muted">
        {r.assignedTo?.name} · out {date(r.checkedOutAt, { year: undefined })}
        {r.dueAt && <> · due {date(r.dueAt, { year: undefined })}</>}
      </p>
      <div className="flex items-center gap-1.5">
        {r.conditionOut && <ConditionPill value={r.conditionOut} />}
        {r.conditionIn && <><ArrowLeftRight size={11} className="text-faint" /><ConditionPill value={r.conditionIn} /></>}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Chain of custody</p>
          <h1 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
            Check-outs{data?.meta?.total != null && <span className="ml-2 font-mono text-base font-medium text-faint tabular">{data.meta.total}</span>}
          </h1>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select value={state} onChange={(e) => setParam({ state: e.target.value })} className="h-9 w-auto">
            {STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
          <Select value={scope} onChange={(e) => setParam({ assignedTo: e.target.value })} className="h-9 w-auto">
            <option value="">Everyone</option>
            <option value="me">Only mine</option>
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={data?.items || []}
          loading={loading}
          onRowClick={(r) => r.asset?._id && navigate(`/assets/${r.asset._id}`)}
          mobileCard={mobileCard}
          empty={
            <EmptyState
              icon={ClipboardList}
              title={state === 'overdue' ? 'Nothing is overdue' : 'No check-outs recorded'}
              description={
                state === 'overdue'
                  ? 'Every asset that is out is still within its due date.'
                  : 'Open an asset and check it out to start its custody record.'
              }
            />
          }
        />
        <Pagination meta={data?.meta} onPageChange={(p) => setParam({ page: p })} />
      </Card>

      {returning && <ReturnDialog entry={returning} onClose={() => setReturning(null)} onDone={reload} />}
    </div>
  );
}
