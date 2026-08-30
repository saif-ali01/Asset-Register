import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ScanBarcode } from 'lucide-react';
import { Button, Card, Field, Input } from '../components/ui/primitives.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

/** Left column carries the product's premise; right column does the work. */
function Frame({ children, title, subtitle, footer }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-surface p-10 lg:flex">
        <div className="flex items-center gap-2.5">
          <ScanBarcode size={22} className="text-brand" />
          <span className="font-display text-base font-bold tracking-tight">Asset Register</span>
        </div>

        <div className="relative max-w-md">
          <p className="eyebrow mb-3">What it answers</p>
          <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-ink">
            What do we own, where is it, and who has it right now?
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Every asset carries a printed tag. Every movement is signed for. Nothing changes
            without leaving a record of who changed it and what it said before.
          </p>

          <dl className="mt-8 grid grid-cols-3 gap-4 border-t border-line pt-6">
            {[['Tagged', 'Sequential asset labels'], ['Signed for', 'Check-out and check-in'], ['Traceable', 'Field-level history']].map(
              ([term, desc]) => (
                <div key={term}>
                  <dt className="font-mono text-xs font-medium uppercase tracking-wider text-brand">{term}</dt>
                  <dd className="mt-1 text-xs leading-snug text-muted">{desc}</dd>
                </div>
              )
            )}
          </dl>
        </div>

        <p className="font-mono text-xs text-faint">Internal use · Access is logged</p>
      </div>

      <div className="flex items-center justify-center p-5 sm:p-8">
        <div className="w-full max-w-sm">
          <div className="mb-7 flex items-center gap-2.5 lg:hidden">
            <ScanBarcode size={22} className="text-brand" />
            <span className="font-display text-base font-bold tracking-tight">Asset Register</span>
          </div>

          <h2 className="font-display text-2xl font-bold tracking-tight text-ink">{title}</h2>
          <p className="mt-1.5 text-sm text-muted">{subtitle}</p>

          <Card className="mt-6 p-5">{children}</Card>
          {footer && <p className="mt-5 text-center text-sm text-muted">{footer}</p>}
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const { login, isAuthenticated } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  if (isAuthenticated) return <Navigate to={location.state?.from || '/'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await login(form.email.trim(), form.password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setErrors(err.details || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame
      title="Sign in"
      subtitle="Use the work account your administrator set up."
      footer={<>No account yet? <Link to="/register" className="font-medium text-brand hover:underline">Request access</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Work email" error={errors.email} required>
          <Input
            type="email" autoComplete="email" required autoFocus
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="you@company.com" invalid={Boolean(errors.email)}
          />
        </Field>

        <Field label="Password" error={errors.password} required>
          <Input
            type="password" autoComplete="current-password" required
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="••••••••" invalid={Boolean(errors.password)}
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
          Sign in
        </Button>
      </form>
    </Frame>
  );
}

export function Register() {
  const { register, isAuthenticated } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '', department: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  if (isAuthenticated) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await register({ ...form, email: form.email.trim() });
      toast.success('Account created. Welcome aboard.');
      navigate('/', { replace: true });
    } catch (err) {
      setErrors(err.details || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame
      title="Request access"
      subtitle="New accounts start with employee access. An admin can widen it."
      footer={<>Already registered? <Link to="/login" className="font-medium text-brand hover:underline">Sign in</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name" error={errors.name} required>
          <Input required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Saif Ali" />
        </Field>
        <Field label="Work email" error={errors.email} required>
          <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@nutraj.com" />
        </Field>
        <Field label="Department" error={errors.department}>
          <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="IT" />
        </Field>
        <Field label="Password" error={errors.password} hint="At least 8 characters, with a letter and a number." required>
          <Input type="password" autoComplete="new-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">Create account</Button>
      </form>
    </Frame>
  );
}
