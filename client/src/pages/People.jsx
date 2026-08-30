import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Download, KeyRound, Pencil, Search, ShieldCheck, Upload, UserPlus, Users,
} from 'lucide-react';
import {
  Avatar, Badge, Button, Card, Checkbox, EmptyState, Field, IconButton, Input, Select, Toggle,
} from '../components/ui/primitives.jsx';
import { ConfirmDialog, Modal } from '../components/ui/overlays.jsx';
import { DataTable, Pagination } from '../components/ui/data.jsx';
import { Can } from '../components/Can.jsx';
import { useApi, useDebounced } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api, downloadFile } from '../lib/api.js';
import { P } from '../lib/constants.js';
import { cx, relative, titleCase } from '../lib/format.js';

const ROLE_TONE = {
  super_admin: 'danger', admin: 'brand', manager: 'steel',
  technician: 'amber', auditor: 'neutral', employee: 'neutral',
};

/**
 * Role sets the baseline. The two lists below are the escape hatches for the
 * cases a role never quite fits — one extra grant, or one thing taken away.
 */
function PermissionEditor({ roleDefaults, extra, denied, onChange, allPermissions }) {
  const grouped = useMemo(() => {
    const groups = {};
    for (const perm of allPermissions) {
      const [resource] = perm.split(':');
      (groups[resource] ||= []).push(perm);
    }
    return groups;
  }, [allPermissions]);

  const toggle = (list, perm) => (list.includes(perm) ? list.filter((p) => p !== perm) : [...list, perm]);

  return (
    <div className="space-y-3">
      {Object.entries(grouped).map(([resource, perms]) => (
        <div key={resource} className="rounded-md border border-line p-3">
          <p className="eyebrow mb-2">{titleCase(resource)}</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {perms.map((perm) => {
              const fromRole = roleDefaults.includes(perm);
              const isExtra = extra.includes(perm);
              const isDenied = denied.includes(perm);
              const effective = (fromRole || isExtra) && !isDenied;

              return (
                <div key={perm} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-raised">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs text-ink">{perm.split(':')[1]}</span>
                    <span className="block text-[0.6875rem] text-faint">
                      {fromRole ? 'from role' : isExtra ? 'added' : 'not in role'}
                      {isDenied && ' · blocked'}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (fromRole) {
                        onChange({ extra, denied: toggle(denied, perm) });
                      } else {
                        onChange({ extra: toggle(extra, perm), denied });
                      }
                    }}
                    className={`h-5 w-9 shrink-0 rounded-full border transition-colors ${
                      effective ? 'border-brand bg-brand' : 'border-line bg-raised'
                    }`}
                    role="switch" aria-checked={effective} aria-label={perm}
                  >
                    <span
                      className={`block h-3.5 w-3.5 rounded-full bg-surface transition-transform ${
                        effective ? 'translate-x-[1.15rem]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function UserDialog({ open, onClose, editing, roles, onDone }) {
  const blank = {
    name: '', email: '', password: '', role: 'employee', department: '',
    designation: '', employeeId: '', phone: '', isActive: true,
  };
  const [form, setForm] = useState(editing ? { ...blank, ...editing, password: '' } : blank);
  const [extra, setExtra] = useState(editing?.extraPermissions || []);
  const [denied, setDenied] = useState(editing?.deniedPermissions || []);
  const [showPerms, setShowPerms] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const roleDef = roles?.roles?.find((r) => r.name === form.role);

  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const payload = {
        name: form.name, email: form.email, role: form.role,
        department: form.department || undefined,
        designation: form.designation || undefined,
        employeeId: form.employeeId || undefined,
        phone: form.phone || undefined,
        extraPermissions: extra, deniedPermissions: denied,
      };
      if (editing) {
        payload.isActive = form.isActive;
        await api.patch(`/users/${editing._id}`, payload);
        toast.success(`${form.name} updated`);
      } else {
        await api.post('/users', { ...payload, password: form.password });
        toast.success(`${form.name} added`);
      }
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
      open={open} onClose={onClose}
      title={editing ? `Edit ${editing.name}` : 'Add a person'}
      description={roleDef?.blurb}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {editing ? 'Save changes' : 'Create account'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" error={errors.name} required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Work email" error={errors.email} required>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>

          {!editing && (
            <Field label="Temporary password" error={errors.password} hint="They can change it after signing in." required className="sm:col-span-2">
              <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="font-mono" />
            </Field>
          )}

          <Field label="Role" error={errors.role} required>
            <Select value={form.role} onChange={(e) => { setForm({ ...form, role: e.target.value }); setExtra([]); setDenied([]); }}>
              {(roles?.roles || []).map((r) => <option key={r.name} value={r.name}>{r.label}</option>)}
            </Select>
          </Field>
          <Field label="Employee ID">
            <Input value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} className="font-mono" />
          </Field>
          <Field label="Department">
            <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          </Field>
          <Field label="Designation">
            <Input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
          </Field>
        </div>

        {editing && (
          <Toggle
            id="active" checked={form.isActive}
            onChange={(v) => setForm({ ...form, isActive: v })}
            label="Account is active"
          />
        )}

        <div className="rounded-card border border-line">
          <button
            type="button" onClick={() => setShowPerms((s) => !s)}
            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-ink">
              <ShieldCheck size={16} className="text-muted" /> Fine-tune permissions
            </span>
            <span className="text-xs text-muted">
              {extra.length > 0 && `+${extra.length} `}
              {denied.length > 0 && `−${denied.length} `}
              {showPerms ? 'Hide' : 'Show'}
            </span>
          </button>
          {showPerms && (
            <div className="border-t border-line p-3">
              <p className="mb-3 text-xs text-muted">
                Switches start from the {roleDef?.label || form.role} role. Turning one off blocks it for this
                person only; turning one on grants it beyond the role.
              </p>
              <PermissionEditor
                roleDefaults={roleDef?.permissions || []}
                extra={extra} denied={denied}
                allPermissions={roles?.permissions || []}
                onChange={({ extra: e, denied: d }) => { setExtra(e); setDenied(d); }}
              />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ResetPasswordDialog({ user, onClose }) {
  const [password, setPassword] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/users/${user._id}/reset-password`, { password, mustChangePassword: mustChange });
      toast.success(res.message);
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open onClose={onClose} title={`Reset password for ${user.name}`}
      description="Their other sessions are signed out immediately."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={password.length < 8}>Reset it</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="New password" hint="At least 8 characters, with a letter and a number." required>
          <Input value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" autoFocus />
        </Field>
        <Checkbox
          label="Require a change at next sign-in"
          checked={mustChange}
          onChange={(e) => setMustChange(e.target.checked)}
        />
      </div>
    </Modal>
  );
}

export function People() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') || '');
  const [dialog, setDialog] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);
  const debounced = useDebounced(search, 300);
  const toast = useToast();
  const { user: me } = useAuth();

  const page = Number(params.get('page') || 1);
  const role = params.get('role') || '';
  const query = useMemo(() => ({ search: debounced, role, page, limit: 25 }), [debounced, role, page]);

  const { data, loading, reload } = useApi('/users', query);
  const { data: roles } = useApi('/users/roles');

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (!v) next.delete(k); else next.set(k, v); }
    if (!('page' in patch)) next.set('page', '1');
    setParams(next, { replace: true });
  };

  const deactivate = async () => {
    setBusy(true);
    try {
      const res = await api.del(`/users/${confirming._id}`);
      toast.success(res.message);
      setConfirming(null);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: 'person', header: 'Person', field: 'name',
      render: (r) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={r.name} src={r.avatarUrl} size={30} />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">
              {r.name}
              {r._id === me?._id && <span className="ml-1.5 text-xs font-normal text-faint">you</span>}
            </p>
            <p className="truncate text-xs text-muted">{r.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role', header: 'Role', field: 'role',
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge tone={ROLE_TONE[r.role]}>{titleCase(r.role)}</Badge>
          {r.extraPermissions?.length > 0 && <Badge tone="steel">+{r.extraPermissions.length}</Badge>}
          {r.deniedPermissions?.length > 0 && <Badge tone="amber">−{r.deniedPermissions.length}</Badge>}
        </div>
      ),
    },
    { key: 'dept', header: 'Department', render: (r) => <span className="text-sm text-muted">{r.department || '—'}</span> },
    { key: 'holding', header: 'Holding', align: 'right', render: (r) => <span className="font-mono text-sm">{r.assetCount}</span> },
    {
      key: 'state', header: 'State',
      render: (r) => (r.isActive
        ? <Badge tone="brand" dot>Active</Badge>
        : <Badge tone="neutral">Deactivated</Badge>),
    },
    { key: 'seen', header: 'Last seen', render: (r) => <span className="text-xs text-muted">{r.lastLoginAt ? relative(r.lastLoginAt) : 'Never'}</span> },
    {
      key: 'actions', header: '', align: 'right',
      render: (r) => (
        <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Can permission={P.USER_WRITE}>
            <IconButton label="Edit" icon={Pencil} onClick={() => { setEditing(r); setDialog('user'); }} />
            <IconButton label="Reset password" icon={KeyRound} onClick={() => setDialog({ reset: r })} />
          </Can>
          <Can permission={P.USER_DELETE}>
            {r.isActive && r._id !== me?._id && (
              <IconButton label="Deactivate" icon={Users} onClick={() => setConfirming(r)} className="hover:text-danger" />
            )}
          </Can>
        </div>
      ),
    },
  ];

  const mobileCard = (r) => (
    <div className="flex items-start gap-3">
      <Avatar name={r.name} src={r.avatarUrl} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink">{r.name}</p>
        <p className="truncate text-xs text-muted">{r.email}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge tone={ROLE_TONE[r.role]}>{titleCase(r.role)}</Badge>
          {!r.isActive && <Badge tone="neutral">Deactivated</Badge>}
          <span className="font-mono text-xs text-faint">{r.assetCount} held</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Access</p>
          <h1 className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
            People{data?.meta?.total != null && <span className="ml-2 font-mono text-base font-medium text-faint tabular">{data.meta.total}</span>}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Can permission={P.USER_READ}>
            <Button
              size="sm" icon={Download}
              onClick={() => downloadFile(
                '/data/users/export', { format: 'xlsx' },
                `people-${new Date().toISOString().slice(0, 10)}.xlsx`
              ).catch((e) => toast.error(e.message))}
            >
              Export
            </Button>
          </Can>
          <Can permission={P.USER_WRITE}>
            <Button size="sm" icon={Upload} onClick={() => setDialog('import')}>Import</Button>
            <Button variant="primary" icon={UserPlus} onClick={() => { setEditing(null); setDialog('user'); }}>
              Add a person
            </Button>
          </Can>
        </div>
      </div>

      <Card className="flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-0 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            value={search} onChange={(e) => { setSearch(e.target.value); setParam({ search: e.target.value }); }}
            placeholder="Search name, email, department" className="pl-9" aria-label="Search people"
          />
        </div>
        <Select value={role} onChange={(e) => setParam({ role: e.target.value })} className="w-auto">
          <option value="">All roles</option>
          {(roles?.roles || []).map((r) => <option key={r.name} value={r.name}>{r.label}</option>)}
        </Select>
      </Card>

      <Card className="overflow-hidden">
        <DataTable
          columns={columns} rows={data?.items || []} loading={loading} mobileCard={mobileCard}
          empty={<EmptyState icon={Users} title="Nobody matches that" description="Try a different name, email or role." />}
        />
        <Pagination meta={data?.meta} onPageChange={(p) => setParam({ page: p })} />
      </Card>

      {roles?.roles && (
        <Card className="p-4">
          <h3 className="mb-1 text-sm font-semibold text-ink">What each role can do</h3>
          <p className="mb-3 text-xs text-muted">Roles are the baseline. Individual permissions can be added or blocked per person.</p>
          <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {roles.roles.map((r) => (
              <li key={r.name} className="rounded-md border border-line bg-raised p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={ROLE_TONE[r.name]}>{r.label}</Badge>
                  <span className="font-mono text-xs text-faint">{r.permissions.length} rights</span>
                </div>
                <p className="mt-1.5 text-xs leading-snug text-muted">{r.blurb}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {dialog === 'user' && (
        <UserDialog
          open onClose={() => { setDialog(null); setEditing(null); }}
          editing={editing} roles={roles} onDone={reload}
        />
      )}
      {dialog?.reset && <ResetPasswordDialog user={dialog.reset} onClose={() => setDialog(null)} />}

      {dialog === 'import' && (
        <UserImportDialog open onClose={() => setDialog(null)} onDone={reload} />
      )}

      <ConfirmDialog
        open={Boolean(confirming)} onClose={() => setConfirming(null)} onConfirm={deactivate} loading={busy}
        title={`Deactivate ${confirming?.name}?`}
        message="They lose access straight away and their sessions end. Their history stays intact, and you can reactivate the account later. Assets they still hold must be checked in first."
        confirmLabel="Deactivate"
      />
    </div>
  );
}

/**
 * Bulk import of people from a spreadsheet. Matched on email, with the same
 * two-step preview-then-commit flow the asset importer uses.
 *
 * Permission overrides are deliberately absent from this screen because they
 * are absent from the API: a role can be set in bulk, but per-person grants
 * cannot, so nobody can widen access by adding a column to a file.
 */
function UserImportDialog({ open, onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [mode, setMode] = useState('upsert');
  const [defaultRole, setDefaultRole] = useState('employee');
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
      const res = await api.post('/data/users/import/preview', body);
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
      body.append('defaultRole', defaultRole);
      body.append('dryRun', String(dryRun));
      const res = await api.post('/data/users/import/commit', body);
      setResult(res);
      if (!dryRun) {
        toast.success(`Added ${res.summary.created} and updated ${res.summary.updated} person(s)`);
        onDone?.();
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const emailIssues = preview?.emailCheck
    ? preview.emailCheck.blankCount + preview.emailCheck.invalidCount + preview.emailCheck.duplicateCount
    : 0;

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Import people from a spreadsheet"
      description="People are matched on email address. Roles can be set here; individual permission overrides cannot."
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
            <span className="text-xs text-muted">Name and email are the essentials. Up to 12 MB.</span>
            <input
              type="file" accept=".xlsx,.xls,.csv" className="sr-only"
              onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
            />
          </label>
          <p className="text-xs text-muted">
            Not sure about the format?{' '}
            <button
              type="button"
              onClick={() => downloadFile('/data/users/template', undefined, 'people-import-template.xlsx')}
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
            <Badge tone="steel">{preview.emailCheck?.distinctEmails ?? 0} distinct email(s)</Badge>
            {preview.emailCheck?.alreadyExist != null && (
              <Badge tone="neutral">{preview.emailCheck.alreadyExist} already have accounts</Badge>
            )}
            <span className="text-muted">Sheet: {preview.sheetName}</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="What this import should do" hint={preview.modes?.[mode]}>
              <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="upsert">Add new and update existing</option>
                <option value="create">Only add new people</option>
                <option value="update">Only update existing people</option>
              </Select>
            </Field>
            <Field label="Role for rows with no role column" hint="Used only when a row does not name one.">
              <Select value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)}>
                {(preview.roles || []).map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
              </Select>
            </Field>
          </div>

          <div
            className={cx(
              'rounded-card border p-3',
              emailIssues ? 'border-danger/40 bg-danger-soft' : 'border-brand/40 bg-brand-soft'
            )}
          >
            <p className="text-sm font-medium text-ink">
              Email column: {preview.emailCheck?.column
                ? <span className="font-mono">{preview.emailCheck.column}</span>
                : <span className="text-danger">not found</span>}
            </p>
            <p className="mt-1 text-xs text-muted">
              People are matched by email, so it must be present, valid and unique in the file.
            </p>
            {preview.emailCheck?.blankCount > 0 && (
              <p className="mt-1.5 text-xs text-danger">
                {preview.emailCheck.blankCount} row(s) have no email and will be rejected.
              </p>
            )}
            {preview.emailCheck?.invalidCount > 0 && (
              <p className="mt-1.5 text-xs text-danger">
                {preview.emailCheck.invalidCount} row(s) have an address that is not a valid email.
              </p>
            )}
            {preview.emailCheck?.duplicateCount > 0 && (
              <p className="mt-1.5 text-xs text-danger">
                {preview.emailCheck.duplicateCount} email(s) appear more than once; only the first is used.
              </p>
            )}
          </div>

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
                        value={mapping[header] || '__ignore__'}
                        onChange={(e) => setMapping({ ...mapping, [header]: e.target.value })}
                        className="h-9"
                      >
                        {preview.fields.map((f) => <option key={f} value={f}>{titleCase(f)}</option>)}
                        <option value="__ignore__">Ignore this column</option>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.blockedFields && Object.keys(preview.blockedFields).length > 0 && (
            <div className="rounded-card border border-line bg-raised p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-ink">
                <ShieldCheck size={15} className="text-muted" /> Not importable, on purpose
              </p>
              <ul className="mt-1.5 space-y-1">
                {Object.entries(preview.blockedFields).map(([field, why]) => (
                  <li key={field} className="text-xs text-muted">
                    <span className="font-mono text-ink">{field}</span> — {why}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Added', result.summary.created, 'brand'],
              ['Updated', result.summary.updated, 'steel'],
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
                {result.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
              </ul>
            </div>
          )}

          {result.notices?.length > 0 && (
            <div className="rounded-card border border-amber/40 bg-amber-soft p-3">
              <p className="mb-1.5 text-sm font-medium text-ink">Worth knowing</p>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted">
                {result.notices.map((n, i) => <li key={i}>{n.row ? `Row ${n.row}: ` : ''}{n.message}</li>)}
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
