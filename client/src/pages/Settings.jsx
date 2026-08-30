import { useState } from 'react';
import { Boxes, MapPin, Pencil, Plus, Store, Trash2, Users2 } from 'lucide-react';
import {
  Badge, Button, Card, EmptyState, Field, IconButton, Input,
  SectionHeader, Select, Textarea,
} from '../components/ui/primitives.jsx';
import { ConfirmDialog, Modal } from '../components/ui/overlays.jsx';
import { Can } from '../components/Can.jsx';
import { useApi } from '../hooks/useApi.js';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { P } from '../lib/constants.js';
import { cx, titleCase } from '../lib/format.js';

const RESOURCES = [
  {
    key: 'categories', label: 'Categories', icon: Boxes,
    blurb: 'How the register is grouped. Keep one spelling per thing — two spellings split the counts.',
    fields: [
      { name: 'code', label: 'Short code', placeholder: 'LT', mono: true },
      { name: 'defaultUsefulLifeMonths', label: 'Default useful life (months)', type: 'number' },
    ],
  },
  {
    key: 'departments', label: 'Departments', icon: Users2,
    blurb: 'Which team an asset belongs to, independent of who is holding it.',
    fields: [{ name: 'code', label: 'Short code', mono: true }],
  },
  {
    key: 'sites', label: 'Sites', icon: MapPin,
    blurb: 'Premises, each with a city and one handler — the person responsible for hardware there.',
    fields: [
      { name: 'code', label: 'Short code', placeholder: 'HO', mono: true },
      { name: 'city', label: 'City', placeholder: 'Noida' },
      { name: 'state', label: 'State' },
      { name: 'kind', label: 'Kind', select: ['head_office', 'factory', 'warehouse', 'retail', 'office', 'other'] },
      { name: 'building', label: 'Building' },
      { name: 'floor', label: 'Floor' },
      { name: 'handler', label: 'Handler', users: true },
    ],
  },
  {
    key: 'vendors', label: 'Vendors', icon: Store,
    blurb: 'Who you buy from and who services the equipment.',
    fields: [
      { name: 'code', label: 'Short code', mono: true },
      { name: 'contactPerson', label: 'Contact person' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'phone', label: 'Phone' },
      { name: 'gstin', label: 'GSTIN', mono: true },
      { name: 'address', label: 'Address', textarea: true },
    ],
  },
];

function LookupDialog({ resource, editing, onClose, onDone }) {
  const [form, setForm] = useState(editing || { name: '' });
  const needsUsers = resource.fields.some((f) => f.users);
  const { data: users } = useApi('/users', { limit: 300, active: 'true', sort: 'name' }, { enabled: needsUsers });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async () => {
    setBusy(true);
    setErrors({});
    const payload = Object.fromEntries(
      Object.entries(form).filter(([k, v]) => !['_id', 'createdAt', 'updatedAt', '__v', 'assetCount', 'createdBy'].includes(k) && v !== '' && v != null)
    );
    try {
      if (editing) await api.patch(`/lookups/${resource.key}/${editing._id}`, payload);
      else await api.post(`/lookups/${resource.key}`, payload);
      toast.success(editing ? `${form.name} updated` : `${form.name} added`);
      onDone();
      onClose();
    } catch (err) {
      setErrors(err.details || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open onClose={onClose}
      title={editing ? `Edit ${editing.name}` : `Add to ${resource.label.toLowerCase()}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!form.name?.trim()}>
            {editing ? 'Save changes' : 'Add it'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={errors.name} required className="sm:col-span-2">
          <Input autoFocus value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>

        {resource.fields.map((f) => (
          <Field key={f.name} label={f.label} error={errors[f.name]} className={f.textarea ? 'sm:col-span-2' : ''}>
            {f.textarea ? (
              <Textarea value={form[f.name] || ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />
            ) : f.select ? (
              <Select value={form[f.name] || ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}>
                {f.select.map((opt) => <option key={opt} value={opt}>{titleCase(opt)}</option>)}
              </Select>
            ) : f.users ? (
              <Select
                value={typeof form[f.name] === 'object' ? form[f.name]?._id || '' : form[f.name] || ''}
                onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
              >
                <option value="">Nobody yet</option>
                {(users?.items || []).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
              </Select>
            ) : (
              <Input
                type={f.type || 'text'} placeholder={f.placeholder}
                value={form[f.name] ?? ''}
                onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                className={cx(f.mono && 'font-mono uppercase')}
              />
            )}
          </Field>
        ))}

        <Field label="Description" className="sm:col-span-2">
          <Textarea value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function LookupSection({ resource }) {
  const { data, loading, reload } = useApi(`/lookups/${resource.key}`, { active: 'all' });
  const [dialog, setDialog] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const Icon = resource.icon;

  const remove = async () => {
    setBusy(true);
    try {
      const res = await api.del(`/lookups/${resource.key}/${confirming._id}`);
      toast.success(res.message);
      setConfirming(null);
      reload();
    } catch (err) {
      toast.error(err.message);
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id={resource.key}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3.5">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-raised text-muted">
            <Icon size={16} />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">
              {resource.label}
              {data?.items && <span className="ml-2 font-mono text-xs text-faint tabular">{data.items.length}</span>}
            </h3>
            <p className="mt-0.5 text-xs leading-snug text-muted">{resource.blurb}</p>
          </div>
        </div>
        <Can permission={P.LOOKUP_WRITE}>
          <Button size="sm" icon={Plus} onClick={() => setDialog({ editing: null })}>Add</Button>
        </Can>
      </div>

      {loading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-9 rounded-md" />)}
        </div>
      ) : data?.items?.length ? (
        <ul className="divide-y divide-line">
          {data.items.map((item) => (
            <li key={item._id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 truncate text-sm font-medium text-ink">
                  {item.name}
                  {item.code && <span className="font-mono text-xs text-faint">{item.code}</span>}
                  {!item.isActive && <Badge tone="neutral">Inactive</Badge>}
                </p>
                {(item.city || item.contactPerson || item.handler) && (
                  <p className="truncate text-xs text-muted">
                    {[
                      item.city,
                      item.handler?.name ? `Handler: ${item.handler.name}` : null,
                      item.contactPerson,
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <span className="shrink-0 font-mono text-xs text-muted tabular">{item.assetCount} asset(s)</span>
              <Can permission={P.LOOKUP_WRITE}>
                <div className="flex shrink-0 gap-0.5">
                  <IconButton label="Edit" icon={Pencil} onClick={() => setDialog({ editing: item })} />
                  <IconButton label="Remove" icon={Trash2} onClick={() => setConfirming(item)} className="hover:text-danger" />
                </div>
              </Can>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={Icon} title={`No ${resource.label.toLowerCase()} yet`}
          description="Add entries here and they become options on every asset form."
          action={
            <Can permission={P.LOOKUP_WRITE}>
              <Button icon={Plus} onClick={() => setDialog({ editing: null })}>Add the first one</Button>
            </Can>
          }
        />
      )}

      {dialog && (
        <LookupDialog
          resource={resource} editing={dialog.editing}
          onClose={() => setDialog(null)} onDone={reload}
        />
      )}
      <ConfirmDialog
        open={Boolean(confirming)} onClose={() => setConfirming(null)} onConfirm={remove} loading={busy}
        title={`Remove ${confirming?.name}?`}
        message="This only works if no asset still points at it. If assets use it, deactivate it instead so history stays readable."
        confirmLabel="Remove"
      />
    </Card>
  );
}

export function Settings() {
  return (
    <div className="space-y-4">
      <SectionHeader
        eyebrow="Configuration"
        title="Settings"
        description="The lists behind every asset form. One spelling per thing, and a handler on every site — that is what makes the counts trustworthy."
      />
      <div className="space-y-4">
        {RESOURCES.map((resource) => <LookupSection key={resource.key} resource={resource} />)}
      </div>
    </div>
  );
}
