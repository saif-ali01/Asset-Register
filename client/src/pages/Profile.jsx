import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, Monitor, Moon, Save, ShieldCheck, Sun } from 'lucide-react';
import {
  Avatar, Badge, Button, Card, Field, Input, SectionHeader,
} from '../components/ui/primitives.jsx';
import { AssetTag, StatusPill } from '../components/ui/data.jsx';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { cx, date, dateTime, titleCase } from '../lib/format.js';

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Match device', icon: Monitor },
];

export function Profile() {
  const { user, permissions, roleInfo, updateProfile } = useAuth();
  const { mode, setMode } = useTheme();
  const toast = useToast();

  const [form, setForm] = useState({
    name: user?.name || '', phone: user?.phone || '',
    department: user?.department || '', designation: user?.designation || '',
  });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);

  const { data: mine } = useApi('/assets', { assignedTo: 'me', limit: 50 });

  const saveProfile = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await updateProfile(form);
      toast.success('Profile saved');
    } catch (err) {
      setErrors(err.details || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwBusy(true);
    setErrors({});
    try {
      const res = await api.post('/auth/change-password', passwords);
      toast.success(res.message);
      setPasswords({ currentPassword: '', newPassword: '' });
    } catch (err) {
      setErrors(err.details || {});
      toast.error(err.message);
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader eyebrow="Your account" title="Profile" />

      <Card className="flex flex-wrap items-center gap-4 p-4 sm:p-5">
        <Avatar name={user?.name} src={user?.avatarUrl} size={56} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-lg font-bold tracking-tight text-ink">{user?.name}</h2>
          <p className="truncate text-sm text-muted">{user?.email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="brand">{roleInfo?.label || titleCase(user?.role || '')}</Badge>
            {user?.employeeId && <span className="font-mono text-xs text-faint">{user.employeeId}</span>}
            {user?.lastLoginAt && <span className="text-xs text-muted">Last signed in {dateTime(user.lastLoginAt)}</span>}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card as="form" onSubmit={saveProfile} className="p-4 sm:p-5">
          <h3 className="mb-4 text-sm font-semibold text-ink">Your details</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" error={errors.name} required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Department">
              <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </Field>
            <Field label="Designation">
              <Input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="submit" variant="primary" icon={Save} loading={busy}>Save changes</Button>
          </div>
        </Card>

        <Card as="form" onSubmit={changePassword} className="p-4 sm:p-5">
          <h3 className="mb-1 text-sm font-semibold text-ink">Password</h3>
          <p className="mb-4 text-xs text-muted">Changing it signs you out everywhere else.</p>
          <div className="space-y-4">
            <Field label="Current password" error={errors.currentPassword} required>
              <Input
                type="password" autoComplete="current-password" value={passwords.currentPassword}
                onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
              />
            </Field>
            <Field label="New password" error={errors.newPassword} hint="At least 8 characters, with a letter and a number." required>
              <Input
                type="password" autoComplete="new-password" value={passwords.newPassword}
                onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="submit" loading={pwBusy} disabled={!passwords.currentPassword || passwords.newPassword.length < 8}>
              Change password
            </Button>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <h3 className="mb-1 text-sm font-semibold text-ink">Appearance</h3>
          <p className="mb-4 text-xs text-muted">Saved on this device.</p>
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map(({ value, label, icon: Icon }) => (
              <button
                key={value} type="button" onClick={() => setMode(value)}
                className={cx(
                  'flex flex-col items-center gap-2 rounded-md border px-3 py-4 text-xs font-medium transition-colors',
                  mode === value ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted hover:bg-raised'
                )}
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
            <ShieldCheck size={16} className="text-muted" /> What you can do
          </h3>
          <p className="mb-3 text-xs text-muted">{roleInfo?.blurb}</p>
          <div className="flex flex-wrap gap-1.5">
            {permissions.map((perm) => (
              <span key={perm} className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted">
                {perm}
              </span>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Signed out to you</h3>
            <p className="mt-0.5 text-xs text-muted">You are responsible for these until they are checked in.</p>
          </div>
          {mine?.meta?.total > 0 && <span className="font-mono text-sm text-ink tabular">{mine.meta.total}</span>}
        </div>
        {mine?.items?.length ? (
          <ul className="divide-y divide-line">
            {mine.items.map((asset) => (
              <li key={asset._id}>
                <Link to={`/assets/${asset._id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-raised">
                  <AssetTag value={asset.tag} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{asset.name}</span>
                  {asset.dueAt && <span className="text-xs text-muted">due {date(asset.dueAt)}</span>}
                  <StatusPill value={asset.status} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 px-4 py-8 text-sm text-muted">
            <Boxes size={16} /> Nothing is signed out to you right now.
          </p>
        )}
      </Card>
    </div>
  );
}
