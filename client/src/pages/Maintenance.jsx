import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Pencil, PlayCircle, Wrench, XCircle } from 'lucide-react';
import {
  Badge, Button, Card, EmptyState, Field, IconButton, Input, Select, Textarea,
} from '../components/ui/primitives.jsx';
import { Modal } from '../components/ui/overlays.jsx';
import { AssetTag, DataTable, JobStatusPill, Pagination } from '../components/ui/data.jsx';
import { Can } from '../components/Can.jsx';
import { useApi } from '../hooks/useApi.js';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import {
  MAINTENANCE_STATUSES, MAINTENANCE_STATUS_META, MAINTENANCE_TYPES, P,
} from '../lib/constants.js';
import { date, money, titleCase } from '../lib/format.js';

function CompleteDialog({ job, onClose, onDone }) {
  const [form, setForm] = useState({
    resolution: '', cost: job.cost ?? '', downtimeHours: '', billNumber: job.billNumber ?? '',
  });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async () => {
    setBusy(true);
    try {
      await api.patch(`/maintenance/${job._id}`, {
        status: 'completed',
        resolution: form.resolution || undefined,
        cost: form.cost || undefined,
        billNumber: form.billNumber || undefined,
        downtimeHours: form.downtimeHours || undefined,
      });
      toast.success('Job closed. The asset is back in stock.');
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
      open onClose={onClose} title={`Close "${job.title}"`}
      description="Completing a repair returns the asset to stock automatically."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy}>Close the job</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="What was done">
          <Textarea value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })} placeholder="Battery replaced under warranty; no charge." />
        </Field>
        <Field label="Bill / invoice number" hint="The vendor's reference, for reconciling the spend later.">
          <Input value={form.billNumber} onChange={(e) => setForm({ ...form, billNumber: e.target.value })} className="font-mono" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Final cost">
            <Input
              type="number" min="0" value={form.cost}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
              className="tabular"
            />
          </Field>
          <Field label="Downtime (hours)">
            <Input
              type="number" min="0" value={form.downtimeHours}
              onChange={(e) => setForm({ ...form, downtimeHours: e.target.value })}
              className="tabular"
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export function MaintenancePage() {
  const [params, setParams] = useSearchParams();
  const [closing, setClosing] = useState(null);
  const [editing, setEditing] = useState(null);
  const navigate = useNavigate();
  const toast = useToast();

  const status = params.get('status') || '';
  const page = Number(params.get('page') || 1);
  const query = useMemo(() => ({ status, page, limit: 25 }), [status, page]);
  const { data, loading, reload } = useApi('/maintenance', query);

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (!v) next.delete(k); else next.set(k, v); }
    if (!('page' in patch)) next.set('page', '1');
    setParams(next, { replace: true });
  };

  const move = async (job, nextStatus, updateAssetStatus) => {
    try {
      const res = await api.patch(`/maintenance/${job._id}`, {
        status: nextStatus,
        ...(updateAssetStatus === undefined ? {} : { updateAssetStatus }),
      });
      const extra = res.assetStatusChanged
        ? ' — the asset is now under repair'
        : res.assetStatusRestored
          ? ' — the asset is back in circulation'
          : '';
      toast.success(`Marked ${MAINTENANCE_STATUS_META[nextStatus].label.toLowerCase()}${extra}`);
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const columns = [
    { key: 'tag', header: 'Tag', render: (r) => <AssetTag value={r.asset?.tag} /> },
    {
      key: 'title', header: 'Job',
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{r.title}</p>
          <p className="truncate text-xs text-muted">{r.asset?.name}</p>
        </div>
      ),
    },
    { key: 'type', header: 'Type', render: (r) => <Badge tone="neutral">{titleCase(r.type)}</Badge> },
    { key: 'status', header: 'Status', render: (r) => <JobStatusPill value={r.status} /> },
    { key: 'when', header: 'Scheduled', render: (r) => <span className="text-sm text-muted">{r.scheduledFor ? date(r.scheduledFor) : '—'}</span> },
    { key: 'who', header: 'Handled by', render: (r) => <span className="text-sm text-muted">{r.vendor?.name || r.technician?.name || '—'}</span> },
    { key: 'bill', header: 'Bill no.', render: (r) => <span className="font-mono text-xs text-muted">{r.billNumber || '—'}</span> },
    { key: 'cost', header: 'Cost', align: 'right', render: (r) => <span className="text-sm">{r.cost != null ? money(r.cost, r.currency) : '—'}</span> },
    {
      key: 'actions', header: '', align: 'right',
      render: (r) => (
        <Can permission={P.MAINTENANCE_WRITE}>
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {r.status === 'scheduled' && (
              <Button
                size="sm" icon={PlayCircle}
                title="Starts the work and moves the asset into the workshop"
                onClick={() => move(r, 'in_progress', true)}
              >
                Start
              </Button>
            )}
            {r.status === 'in_progress' && (
              <Button size="sm" variant="primary" icon={CheckCircle2} onClick={() => setClosing(r)}>Close</Button>
            )}
            {['scheduled', 'in_progress'].includes(r.status) && (
              <Button size="sm" variant="ghost" icon={XCircle} onClick={() => move(r, 'cancelled')}>Cancel</Button>
            )}
            <IconButton label="Edit job" icon={Pencil} onClick={() => setEditing(r)} />
          </div>
        </Can>
      ),
    },
  ];

  const mobileCard = (r) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <AssetTag value={r.asset?.tag} />
        <JobStatusPill value={r.status} />
      </div>
      <p className="font-medium leading-snug text-ink">{r.title}</p>
      <p className="text-xs text-muted">
        {r.asset?.name} · {titleCase(r.type)}
        {r.scheduledFor && <> · {date(r.scheduledFor, { year: undefined })}</>}
      </p>
      {r.cost != null && <p className="font-mono text-xs text-ink tabular">{money(r.cost, r.currency)}</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Workshop</p>
          <h1 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">Maintenance</h1>
        </div>
        <Select value={status} onChange={(e) => setParam({ status: e.target.value })} className="h-9 w-auto">
          <option value="">All jobs</option>
          {MAINTENANCE_STATUSES.map((s) => (
            <option key={s} value={s}>{MAINTENANCE_STATUS_META[s].label}</option>
          ))}
        </Select>
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
              icon={Wrench} title="No maintenance jobs"
              description="Open an asset and raise a job when something needs a repair or a scheduled service."
            />
          }
        />
        <Pagination meta={data?.meta} onPageChange={(p) => setParam({ page: p })} />
      </Card>

      {closing && <CompleteDialog job={closing} onClose={() => setClosing(null)} onDone={reload} />}
      {editing && <EditJobDialog job={editing} onClose={() => setEditing(null)} onDone={reload} />}
    </div>
  );
}

/**
 * Full edit of a maintenance job. Separate from the Close dialog because
 * closing is a state change with its own required fields, whereas this is
 * plain correction — a wrong title, a mis-typed date, a bill number that
 * arrived after the job was already closed.
 */
function EditJobDialog({ job, onClose, onDone }) {
  const asDate = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
  const [form, setForm] = useState({
    title: job.title || '',
    type: job.type || 'repair',
    status: job.status || 'scheduled',
    description: job.description || '',
    scheduledFor: asDate(job.scheduledFor),
    completedAt: asDate(job.completedAt),
    billNumber: job.billNumber || '',
    cost: job.cost ?? '',
    downtimeHours: job.downtimeHours ?? '',
    resolution: job.resolution || '',
    vendor: job.vendor?._id || job.vendor || '',
    technician: job.technician?._id || job.technician || '',
  });
  const [busy, setBusy] = useState(false);
  const { data: vendors } = useApi('/lookups/vendors');
  const { data: people } = useApi('/users', { limit: 300, active: 'true', sort: 'name' });
  const toast = useToast();

  const statusChanged = form.status !== job.status;

  const submit = async () => {
    setBusy(true);
    try {
      // Blank strings would clear real values, so only send what is filled in.
      const payload = Object.fromEntries(
        Object.entries(form).filter(([, v]) => v !== '' && v !== null && v !== undefined)
      );
      const res = await api.patch(`/maintenance/${job._id}`, payload);
      const extra = res.assetStatusChanged
        ? ' — the asset is now under repair'
        : res.assetStatusRestored
          ? ' — the asset is back to its previous state'
          : '';
      toast.success(`Job updated${extra}`);
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
      title={`Edit "${job.title}"`}
      description={job.asset?.tag ? `On ${job.asset.tag} — ${job.asset.name || ''}` : undefined}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={form.title.trim().length < 3}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="What needs doing" required>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {MAINTENANCE_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
          </Field>
          <Field
            label="Status"
            hint={statusChanged ? 'Changing this can move the asset in or out of the workshop.' : undefined}
          >
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {MAINTENANCE_STATUSES.map((st) => (
                <option key={st} value={st}>{MAINTENANCE_STATUS_META[st].label}</option>
              ))}
            </Select>
          </Field>

          <Field label="Scheduled for">
            <Input type="date" value={form.scheduledFor} onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })} />
          </Field>
          <Field label="Completed on" hint="Correct this if the job was closed on the wrong day.">
            <Input type="date" value={form.completedAt} onChange={(e) => setForm({ ...form, completedAt: e.target.value })} />
          </Field>

          <Field label="Vendor">
            <Select value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })}>
              <option value="">Not set</option>
              {(vendors?.items || []).map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
            </Select>
          </Field>
          <Field label="Technician">
            <Select value={form.technician} onChange={(e) => setForm({ ...form, technician: e.target.value })}>
              <option value="">Not set</option>
              {(people?.items || []).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
            </Select>
          </Field>

          <Field label="Bill / invoice number">
            <Input
              value={form.billNumber}
              onChange={(e) => setForm({ ...form, billNumber: e.target.value })}
              className="font-mono"
            />
          </Field>
          <Field label="Cost">
            <Input
              type="number" min="0" value={form.cost}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
              className="tabular"
            />
          </Field>
          <Field label="Downtime (hours)">
            <Input
              type="number" min="0" value={form.downtimeHours}
              onChange={(e) => setForm({ ...form, downtimeHours: e.target.value })}
              className="tabular"
            />
          </Field>
        </div>

        <Field label="Details">
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="What was done">
          <Textarea value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
