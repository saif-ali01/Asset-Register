import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Archive, ArrowLeft, ArrowLeftRight, ClipboardList, History, Pencil,
  ShieldCheck, Trash2, Undo2, UserPlus, Wrench,
} from 'lucide-react';
import {
  Badge, Button, Card, Checkbox, EmptyState, Field, IconButton,
  Input, Select, Textarea, Spinner,
} from '../components/ui/primitives.jsx';
import { ConfirmDialog, Modal } from '../components/ui/overlays.jsx';
import { AssetTag, ConditionPill, JobStatusPill, StatusPill } from '../components/ui/data.jsx';
import { HistoryTrail } from '../components/HistoryTrail.jsx';
import { Can } from '../components/Can.jsx';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { CONDITIONS, MAINTENANCE_TYPES, P, STATUS_META } from '../lib/constants.js';
import { cx, date, dateTime, daysUntil, money, relative, titleCase } from '../lib/format.js';

const TABS = [
  { key: 'details', label: 'Details' },
  { key: 'custody', label: 'Custody', icon: ClipboardList },
  { key: 'maintenance', label: 'Maintenance', icon: Wrench },
  { key: 'history', label: 'History', icon: History },
];

function Row({ label, children, mono }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      <dd className={cx('min-w-0 text-right text-sm text-ink', mono && 'font-mono tabular')}>
        {children ?? <span className="text-faint">—</span>}
      </dd>
    </div>
  );
}

function CheckoutDialog({ open, onClose, asset, onDone }) {
  const [form, setForm] = useState({ assignedTo: '', dueAt: '', conditionOut: asset.condition || 'good', notesOut: '' });
  const [busy, setBusy] = useState(false);
  const { data: users } = useApi('/users', { limit: 500, active: 'true', sort: 'name' }, { enabled: open });
  const toast = useToast();

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/assignments/checkout', {
        asset: asset._id,
        assignedTo: form.assignedTo,
        dueAt: form.dueAt || undefined,
        conditionOut: form.conditionOut || undefined,
        notesOut: form.notesOut || undefined,
      });
      toast.success(`${asset.tag} signed out`);
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
      open={open} onClose={onClose} title={`Check out ${asset.tag}`}
      description="The person becomes responsible for the asset until it is checked back in."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!form.assignedTo}>Sign it out</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Give it to" required>
          <Select value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}>
            <option value="">Choose a person</option>
            {(users?.items || []).map((u) => (
              <option key={u._id} value={u._id}>
                {u.name}{u.department ? ` — ${u.department}` : ''}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Due back" hint="Leave blank for an open-ended issue.">
            <Input type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
          </Field>
          <Field label="Condition going out">
            <Select value={form.conditionOut} onChange={(e) => setForm({ ...form, conditionOut: e.target.value })}>
              {CONDITIONS.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="Note" hint="What went with it — charger, case, dongle.">
          <Textarea value={form.notesOut} onChange={(e) => setForm({ ...form, notesOut: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function CheckinDialog({ open, onClose, assignment, asset, onDone }) {
  const [form, setForm] = useState({ conditionIn: asset.condition || 'good', status: 'available', notesIn: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/assignments/${assignment._id}/checkin`, {
        conditionIn: form.conditionIn || undefined,
        status: form.status,
        notesIn: form.notesIn || undefined,
      });
      toast.success(`${asset.tag} received back`);
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
      open={open} onClose={onClose} title={`Check in ${asset.tag}`}
      description={`Returning from ${assignment?.assignedTo?.name || 'the current holder'}.`}
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
          <Textarea value={form.notesIn} onChange={(e) => setForm({ ...form, notesIn: e.target.value })} placeholder="Scratches, missing charger, works fine." />
        </Field>
      </div>
    </Modal>
  );
}

function MaintenanceDialog({ open, onClose, asset, onDone }) {
  const [form, setForm] = useState({ title: '', type: 'repair', scheduledFor: '', description: '', cost: '' });
  const [startNow, setStartNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: vendors } = useApi('/lookups/vendors', undefined, { enabled: open });
  const toast = useToast();

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post('/maintenance', {
        asset: asset._id,
        title: form.title,
        type: form.type,
        scheduledFor: form.scheduledFor || undefined,
        description: form.description || undefined,
        cost: form.cost || undefined,
        vendor: form.vendor || undefined,
        // Scheduling alone leaves the asset exactly where it is.
        ...(startNow ? { status: 'in_progress', updateAssetStatus: true } : {}),
      });
      toast.success(
        res.assetStatusChanged
          ? `Job raised — ${asset.tag} is now under repair`
          : 'Job scheduled. The asset has not been moved.'
      );
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
      open={open} onClose={onClose} title={`Raise a job for ${asset.tag}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={form.title.trim().length < 3}>Raise job</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="What needs doing" required>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Battery replacement" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {MAINTENANCE_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </Select>
          </Field>
          <Field label="Scheduled for">
            <Input type="date" value={form.scheduledFor} onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })} />
          </Field>
          <Field label="Vendor">
            <Select value={form.vendor || ''} onChange={(e) => setForm({ ...form, vendor: e.target.value })}>
              <option value="">Not set</option>
              {(vendors?.items || []).map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
            </Select>
          </Field>
          <Field label="Estimated cost">
            <Input type="number" min="0" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} className="tabular" />
          </Field>
        </div>
        <Field label="Details">
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>

        <div className="rounded-md border border-line bg-raised p-3">
          <Checkbox
            label="Start the work now and move it to the workshop"
            checked={startNow}
            onChange={(e) => setStartNow(e.target.checked)}
          />
          <p className="mt-1.5 text-xs text-muted">
            {startNow
              ? `${asset.tag} will be marked under repair and released from whoever holds it.`
              : `Scheduling on its own changes nothing — ${asset.tag} stays ${STATUS_META[asset.status]?.label.toLowerCase() || asset.status} until someone starts the job.`}
          </p>
        </div>
      </div>
    </Modal>
  );
}

export function AssetDetail() {
  const { id } = useParams();
  const [tab, setTab] = useState('details');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();

  const { data, loading, reload } = useApi(`/assets/${id}`, { archived: 'true' });

  if (loading) {
    return <div className="flex justify-center py-20"><Spinner size={26} /></div>;
  }
  if (!data?.asset) {
    return <EmptyState icon={Archive} title="Asset not found" description="It may have been deleted, or you may not have access to it." action={<Link to="/assets" className="text-sm font-medium text-brand hover:underline">Back to the register</Link>} />;
  }

  const asset = data.asset;
  const openAssignment = data.custody?.find((c) => !c.checkedInAt);
  const warrantyDays = daysUntil(asset.warrantyExpiry);

  const archive = async () => {
    setBusy(true);
    try {
      const res = await api.del(`/assets/${asset._id}`);
      toast.success(res.message);
      setDialog(null);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    try {
      await api.post(`/assets/${asset._id}/restore`);
      toast.success(`${asset.tag} restored`);
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" icon={ArrowLeft} onClick={() => navigate('/assets')}>Register</Button>
      </div>

      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <AssetTag value={asset.tag} />
              <StatusPill value={asset.status} />
              <ConditionPill value={asset.condition} />
              {asset.isArchived && <Badge tone="neutral">Archived</Badge>}
            </div>

            <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-ink">{asset.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {[asset.brand, asset.model, asset.category?.name].filter(Boolean).join(' · ') || 'No make or model recorded'}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
              {asset.serialNumber && (
                <span className="text-muted">Serial <span className="font-mono text-ink">{asset.serialNumber}</span></span>
              )}
              {asset.site?.name && (
                <span className="text-muted">
                  At <span className="text-ink">{asset.site.name}</span>
                  {asset.site.city && <span className="text-faint"> · {asset.site.city}</span>}
                </span>
              )}
              {asset.site?.handler && (
                <span className="text-muted">Handler <span className="text-ink">{asset.site.handler.name}</span></span>
              )}
              {asset.department?.name && (
                <span className="text-muted">For <span className="text-ink">{asset.department.name}</span></span>
              )}
              {asset.assignedTo ? (
                <span className="text-muted">
                  Held by <Link to={`/people?search=${encodeURIComponent(asset.assignedTo.email)}`} className="font-medium text-brand hover:underline">{asset.assignedTo.name}</Link>
                  {asset.assignedAt && <span className="text-faint"> since {date(asset.assignedAt)}</span>}
                </span>
              ) : asset.assignedToLabel ? (
                <span className="text-muted">
                  Held by <span className="text-ink">{asset.assignedToLabel}</span>
                  <Badge tone="amber" className="ml-1.5">no matching account</Badge>
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {asset.isArchived ? (
              <Can permission={P.ASSET_UPDATE}>
                <Button icon={Undo2} onClick={restore}>Restore</Button>
              </Can>
            ) : (
              <>
                {openAssignment ? (
                  <Can permission={P.ASSIGNMENT_CHECKIN}>
                    <Button variant="primary" icon={Undo2} onClick={() => setDialog('checkin')}>Check in</Button>
                  </Can>
                ) : (
                  <Can permission={P.ASSIGNMENT_CHECKOUT}>
                    <Button variant="primary" icon={UserPlus} onClick={() => setDialog('checkout')}>Check out</Button>
                  </Can>
                )}
                <Can permission={P.MAINTENANCE_WRITE}>
                  <Button icon={Wrench} onClick={() => setDialog('maintenance')}>Raise job</Button>
                </Can>
                <Can permission={P.ASSET_UPDATE}>
                  <IconButton label="Edit asset" icon={Pencil} onClick={() => navigate(`/assets/${asset._id}/edit`)} />
                </Can>
                <Can permission={P.ASSET_DELETE}>
                  <IconButton label="Archive asset" icon={Trash2} onClick={() => setDialog('archive')} className="hover:text-danger" />
                </Can>
              </>
            )}
          </div>
        </div>

        {asset.imageUrl && (
          <img
            src={asset.imageUrl}
            alt=""
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
            className="mt-4 h-28 w-28 rounded-md border border-line object-contain bg-raised p-1"
          />
        )}

        {asset.dueAt && !asset.isArchived && (
          <div className={cx(
            'mt-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
            daysUntil(asset.dueAt) < 0 ? 'border-danger/40 bg-danger-soft text-ink' : 'border-line bg-raised text-muted'
          )}>
            <ClipboardList size={16} className={daysUntil(asset.dueAt) < 0 ? 'text-danger' : 'text-muted'} />
            {daysUntil(asset.dueAt) < 0
              ? `Overdue by ${Math.abs(daysUntil(asset.dueAt))} day(s) — due back ${date(asset.dueAt)}`
              : `Due back ${date(asset.dueAt)} (${daysUntil(asset.dueAt)} day(s) away)`}
          </div>
        )}
      </Card>

      <div className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key} type="button" onClick={() => setTab(key)}
            className={cx(
              'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              tab === key ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink'
            )}
          >
            {Icon && <Icon size={15} />}
            {label}
            {key === 'custody' && data.custody?.length > 0 && (
              <span className="font-mono text-xs text-faint">{data.custody.length}</span>
            )}
            {key === 'maintenance' && data.maintenance?.length > 0 && (
              <span className="font-mono text-xs text-faint">{data.maintenance.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold text-ink">Identity</h3>
            <dl>
              <Row label="Category">{asset.category?.name}</Row>
              <Row label="Sub category">{asset.subCategory}</Row>
              <Row label="Owning company">{asset.entity}</Row>
              <Row label="Brand">{asset.brand}</Row>
              <Row label="Model" mono>{asset.model}</Row>
              <Row label="Serial number" mono>{asset.serialNumber}</Row>
              <Row label="Quantity" mono>{asset.quantity} {asset.unit}</Row>
            </dl>
          </Card>

          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold text-ink">Where and who</h3>
            <dl>
              <Row label="Site">{asset.site?.name}</Row>
              <Row label="City">{asset.site?.city}</Row>
              <Row label="Handler">{asset.site?.handler?.name}</Row>
              <Row label="Department">{asset.department?.name}</Row>
              <Row label="Added">{dateTime(asset.createdAt)}</Row>
              <Row label="Last edited">{relative(asset.updatedAt)}</Row>
            </dl>
          </Card>

          {(asset.purchaseCost != null || asset.warrantyExpiry || asset.vendor) && (
            <Card className="p-4 lg:col-span-2">
              <h3 className="mb-2 text-sm font-semibold text-ink">Purchase and cover</h3>
              <dl className="grid gap-x-8 sm:grid-cols-2">
                <Row label="Vendor">{asset.vendor?.name}</Row>
                <Row label="Purchase date">{asset.purchaseDate ? date(asset.purchaseDate) : null}</Row>
                <Row label="Purchase cost" mono>{asset.purchaseCost != null ? money(asset.purchaseCost, asset.currency) : null}</Row>
                <Row label="Book value today" mono>{asset.currentValue != null ? money(asset.currentValue, asset.currency) : null}</Row>
                <Row label="Warranty">
                  {asset.warrantyExpiry ? (
                    <span className="inline-flex items-center gap-2">
                      {date(asset.warrantyExpiry)}
                      <Badge tone={warrantyDays < 0 ? 'danger' : warrantyDays <= 30 ? 'amber' : 'brand'}>
                        {warrantyDays < 0 ? 'expired' : `${warrantyDays}d left`}
                      </Badge>
                    </span>
                  ) : null}
                </Row>
                <Row label="Invoice" mono>{asset.invoiceNumber}</Row>
              </dl>
            </Card>
          )}

          {asset.notes && (
            <Card className="p-4 lg:col-span-2">
              <h3 className="mb-2 text-sm font-semibold text-ink">Notes</h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">{asset.notes}</p>
            </Card>
          )}

          {asset.customFields && Object.keys(asset.customFields).length > 0 && (
            <Card className="p-4 lg:col-span-2">
              <h3 className="mb-1 text-sm font-semibold text-ink">From your spreadsheet</h3>
              <p className="mb-2 text-xs text-muted">Columns that had no matching field were kept here rather than dropped.</p>
              <dl className="grid gap-x-8 sm:grid-cols-2">
                {Object.entries(asset.customFields).map(([key, value]) => (
                  <Row key={key} label={key}>{value}</Row>
                ))}
              </dl>
            </Card>
          )}
        </div>
      )}

      {tab === 'custody' && (
        <Card>
          {data.custody?.length ? (
            <ul className="divide-y divide-line">
              {data.custody.map((entry) => (
                <li key={entry._id} className="flex flex-wrap items-start gap-3 px-4 py-3.5">
                  <span className={cx(
                    'mt-1 h-2 w-2 shrink-0 rounded-full',
                    entry.checkedInAt ? 'bg-faint' : entry.isOverdue ? 'bg-danger' : 'bg-brand'
                  )} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">
                      {entry.assignedTo?.name || 'Unknown'}
                      {!entry.checkedInAt && <Badge tone={entry.isOverdue ? 'danger' : 'brand'} className="ml-2">{entry.isOverdue ? 'Overdue' : 'Holding now'}</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      Out {date(entry.checkedOutAt)} by {entry.assignedBy?.name || '—'}
                      {entry.checkedInAt && <> · back {date(entry.checkedInAt)}</>}
                      {entry.dueAt && !entry.checkedInAt && <> · due {date(entry.dueAt)}</>}
                    </p>
                    {(entry.notesOut || entry.notesIn) && (
                      <p className="mt-1 text-xs italic text-muted">{entry.notesIn || entry.notesOut}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {entry.conditionOut && <ConditionPill value={entry.conditionOut} />}
                    {entry.conditionIn && (
                      <>
                        <ArrowLeftRight size={12} className="text-faint" />
                        <ConditionPill value={entry.conditionIn} />
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={ClipboardList} title="Never been checked out"
              description="Sign it out to someone and the chain of custody starts here."
              action={
                <Can permission={P.ASSIGNMENT_CHECKOUT}>
                  <Button variant="primary" icon={UserPlus} onClick={() => setDialog('checkout')}>Check out</Button>
                </Can>
              }
            />
          )}
        </Card>
      )}

      {tab === 'maintenance' && (
        <Card>
          {data.maintenance?.length ? (
            <ul className="divide-y divide-line">
              {data.maintenance.map((job) => (
                <li key={job._id} className="flex flex-wrap items-start gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-ink">{job.title}</p>
                      <JobStatusPill value={job.status} />
                      <Badge tone="neutral">{titleCase(job.type)}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {job.scheduledFor && <>Scheduled {date(job.scheduledFor)} · </>}
                      {job.vendor?.name && <>{job.vendor.name} · </>}
                      {job.technician?.name && <>{job.technician.name}</>}
                    </p>
                    {job.resolution && <p className="mt-1 text-xs italic text-muted">{job.resolution}</p>}
                  </div>
                  {job.cost != null && <span className="font-mono text-sm text-ink tabular">{money(job.cost, job.currency)}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Wrench} title="No maintenance recorded"
              description="Raise a job when something needs a repair, an upgrade or a scheduled service."
              action={
                <Can permission={P.MAINTENANCE_WRITE}>
                  <Button variant="primary" icon={Wrench} onClick={() => setDialog('maintenance')}>Raise a job</Button>
                </Can>
              }
            />
          )}
        </Card>
      )}

      {tab === 'history' && (
        <Card className="px-4 py-2">
          <HistoryTrail entries={data.history} emptyIcon={ShieldCheck} emptyTitle="No changes recorded yet" />
        </Card>
      )}

      {dialog === 'checkout' && (
        <CheckoutDialog open onClose={() => setDialog(null)} asset={asset} onDone={reload} />
      )}
      {dialog === 'checkin' && openAssignment && (
        <CheckinDialog open onClose={() => setDialog(null)} assignment={openAssignment} asset={asset} onDone={reload} />
      )}
      {dialog === 'maintenance' && (
        <MaintenanceDialog open onClose={() => setDialog(null)} asset={asset} onDone={reload} />
      )}
      <ConfirmDialog
        open={dialog === 'archive'} onClose={() => setDialog(null)} onConfirm={archive} loading={busy}
        title={`Archive ${asset.tag}?`}
        message="The record stays in the system and keeps its full history, but it drops out of the active register. You can restore it at any time."
        confirmLabel="Archive it"
      />
    </div>
  );
}
