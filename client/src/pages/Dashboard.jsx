import { Link } from 'react-router-dom';
import {
  AlertTriangle, Boxes, CircleSlash, Clock, PackageCheck, ShieldCheck, Wrench,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Badge, Card, EmptyState, SectionHeader, Skeleton } from '../components/ui/primitives.jsx';
import { HistoryTrail } from '../components/HistoryTrail.jsx';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { STATUS_META } from '../lib/constants.js';
import { compactMoney, cx, titleCase } from '../lib/format.js';

const TONE_HEX = {
  brand: 'rgb(var(--brand))', amber: 'rgb(var(--amber))',
  danger: 'rgb(var(--danger))', steel: 'rgb(var(--steel))', neutral: 'rgb(var(--faint))',
};

function Stat({ icon: Icon, label, value, sub, tone = 'neutral', to }) {
  const body = (
    <Card className={cx('flex items-start gap-3 p-4 transition-colors', to && 'hover:border-brand/40')}>
      <span
        className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-raised"
        style={{ borderColor: TONE_HEX[tone], color: TONE_HEX[tone] }}
      >
        <Icon size={17} />
      </span>
      <div className="min-w-0">
        <p className="eyebrow">{label}</p>
        <p className="mt-1 font-display text-2xl font-bold tracking-tight text-ink tabular">{value}</p>
        {sub && <p className="mt-0.5 truncate text-xs text-muted">{sub}</p>}
      </div>
    </Card>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-2.5 py-1.5 shadow-pop">
      <p className="text-xs font-medium text-ink">{label}</p>
      <p className="font-mono text-xs text-muted tabular">{payload[0].value} asset(s)</p>
    </div>
  );
}

/** A count that links straight into a filtered register view. */
function CountLink({ to, value, muted }) {
  if (!value) return <span className="text-faint tabular">—</span>;
  return (
    <Link to={to} className={cx('font-mono tabular hover:underline', muted ? 'text-muted' : 'text-ink')}>
      {value}
    </Link>
  );
}

export function Dashboard() {
  const { user, roleInfo, can } = useAuth();
  const { data, loading } = useApi('/dashboard');

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-card" />)}
        </div>
        <Skeleton className="h-72 rounded-card" />
      </div>
    );
  }

  const t = data?.totals || {};
  const statusData = (data?.byStatus || []).map((s) => ({
    name: STATUS_META[s._id]?.label || titleCase(s._id || 'Unknown'),
    count: s.count,
    fill: TONE_HEX[STATUS_META[s._id]?.tone || 'neutral'],
  }));

  // Only worth showing money when some of the register actually carries a cost.
  const showValue = (t.costedAssets || 0) > 0;

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        title={`Good to see you, ${user?.name?.split(' ')[0] || 'there'}`}
        description={roleInfo?.blurb}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={Boxes} label="On the register" value={t.assets ?? 0} tone="brand"
          sub="Excludes archived records" to="/assets"
        />
        <Stat
          icon={PackageCheck} label="Checked out" value={t.held ?? 0} tone="steel"
          sub="In someone's hands right now" to="/assets?status=checked_out"
        />
        <Stat
          icon={Wrench} label="In repair" value={(data?.byStatus || []).find((s) => s._id === 'under_repair')?.count || 0}
          tone={t.openMaintenance ? 'amber' : 'neutral'}
          sub={`${t.openMaintenance ?? 0} open job(s)`} to="/maintenance"
        />
        {showValue ? (
          <Stat
            icon={CircleSlash} label="Recorded value" value={compactMoney(t.purchaseValue)} tone="neutral"
            sub={`From ${t.costedAssets} asset(s) with a cost`}
          />
        ) : (
          <Stat
            icon={CircleSlash} label="Closed out" value={t.closed ?? 0} tone="neutral"
            sub="Disposed, sold, donated or lost" to="/assets?status=disposed,sold,donated,lost_missing"
          />
        )}
      </div>

      {t.overdue > 0 && (
        <Card className="flex flex-wrap items-center gap-3 border-danger/40 bg-danger-soft p-4">
          <Clock size={18} className="text-danger" />
          <p className="flex-1 text-sm text-ink">
            <strong className="font-semibold">{t.overdue}</strong> asset(s) are past their due-back date.
          </p>
          <Link to="/custody?state=overdue" className="text-sm font-medium text-danger hover:underline">
            See who has them
          </Link>
        </Card>
      )}

      {(t.warrantyExpiring > 0 || t.warrantyExpired > 0) && (
        <Card className="flex flex-wrap items-center gap-3 border-amber/40 bg-amber-soft p-4">
          <AlertTriangle size={18} className="text-amber" />
          <p className="flex-1 text-sm text-ink">
            <strong className="font-semibold">{t.warrantyExpiring}</strong> warranties expire within 30 days
            {t.warrantyExpired > 0 && <> and <strong className="font-semibold">{t.warrantyExpired}</strong> have lapsed</>}.
          </p>
          <Link to="/assets?warranty=expiring" className="text-sm font-medium text-amber hover:underline">
            Review them
          </Link>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">Where the register sits</h3>
            <p className="mt-0.5 text-xs text-muted">Count of assets by status</p>
          </div>
          <div className="h-64 p-3">
            {statusData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="rgb(var(--line))" vertical={false} />
                  <XAxis
                    dataKey="name" tickLine={false} axisLine={false} interval={0}
                    tick={{ fontSize: 11, fill: 'rgb(var(--muted))' }} angle={-18} textAnchor="end" height={52}
                  />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'rgb(var(--faint))' }} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgb(var(--raised))' }} />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={52}>
                    {statusData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState icon={Boxes} title="Nothing on the register yet" description="Import your workbook to see this chart." />
            )}
          </div>
        </Card>

        <Card>
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">By handler</h3>
            <p className="mt-0.5 text-xs text-muted">Who is responsible, via their sites</p>
          </div>
          <ul className="divide-y divide-line">
            {(data?.byHandler || []).map((h) => (
              <li key={h._id || h.name} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{h.name}</span>
                <span className="font-mono text-xs text-muted tabular" title="Checked out">{h.checkedOut}</span>
                <span className="font-mono text-sm font-medium text-ink tabular">{h.total}</span>
              </li>
            ))}
            {!data?.byHandler?.length && <li className="px-4 py-8 text-center text-sm text-muted">No handlers set</li>}
          </ul>
        </Card>
      </div>

      {/* The register's own pivot: one row per site, status across the columns. */}
      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">By site</h3>
          <p className="mt-0.5 text-xs text-muted">Every count links through to the matching filter</p>
        </div>

        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-raised text-eyebrow font-mono uppercase text-faint">
                <th className="px-3 py-2 text-left">Site</th>
                <th className="px-3 py-2 text-left">City</th>
                <th className="px-3 py-2 text-left">Handler</th>
                <th className="px-3 py-2 text-right">Available</th>
                <th className="px-3 py-2 text-right">Checked out</th>
                <th className="px-3 py-2 text-right">Repair</th>
                <th className="px-3 py-2 text-right">Disposed</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(data?.bySite || []).map((row) => (
                <tr key={row._id || row.name} className="hover:bg-raised">
                  <td className="px-3 py-2 font-medium text-ink">
                    <Link to={`/assets?site=${row._id || ''}`} className="hover:underline">{row.name}</Link>
                  </td>
                  <td className="px-3 py-2 text-muted">{row.city || '—'}</td>
                  <td className="px-3 py-2 text-muted">{row.handler || '—'}</td>
                  <td className="px-3 py-2 text-right"><CountLink to={`/assets?site=${row._id || ''}&status=available`} value={row.available} muted /></td>
                  <td className="px-3 py-2 text-right"><CountLink to={`/assets?site=${row._id || ''}&status=checked_out`} value={row.checkedOut} muted /></td>
                  <td className="px-3 py-2 text-right"><CountLink to={`/assets?site=${row._id || ''}&status=under_repair`} value={row.underRepair} muted /></td>
                  <td className="px-3 py-2 text-right"><CountLink to={`/assets?site=${row._id || ''}&status=disposed`} value={row.disposed} muted /></td>
                  <td className="px-3 py-2 text-right font-mono font-medium text-ink tabular">{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="divide-y divide-line sm:hidden">
          {(data?.bySite || []).map((row) => (
            <li key={row._id || row.name} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <Link to={`/assets?site=${row._id || ''}`} className="min-w-0 font-medium text-ink hover:underline">
                  {row.name}
                </Link>
                <span className="font-mono text-sm tabular text-ink">{row.total}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {[row.city, row.handler && `Handler: ${row.handler}`].filter(Boolean).join(' · ') || '—'}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {row.available > 0 && <Badge tone="brand">{row.available} available</Badge>}
                {row.checkedOut > 0 && <Badge tone="steel">{row.checkedOut} out</Badge>}
                {row.underRepair > 0 && <Badge tone="amber">{row.underRepair} repair</Badge>}
                {row.disposed > 0 && <Badge tone="neutral">{row.disposed} disposed</Badge>}
              </div>
            </li>
          ))}
          {!data?.bySite?.length && <li className="px-4 py-8 text-center text-sm text-muted">No sites yet</li>}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">By category</h3>
          </div>
          <ul className="divide-y divide-line">
            {(data?.byCategory || []).slice(0, 10).map((row) => (
              <li key={row._id || row.name} className="flex items-center gap-3 px-4 py-2.5">
                <Link to={`/assets?category=${row._id || ''}`} className="min-w-0 flex-1 truncate text-sm text-ink hover:underline">
                  {row.name}
                </Link>
                <span className="font-mono text-sm text-muted tabular">{row.count}</span>
              </li>
            ))}
            {!data?.byCategory?.length && <li className="px-4 py-8 text-center text-sm text-muted">No categories yet</li>}
          </ul>
        </Card>

        <Card>
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">By department</h3>
          </div>
          <ul className="divide-y divide-line">
            {(data?.byDepartment || []).slice(0, 10).map((row) => (
              <li key={row._id || row.name} className="flex items-center gap-3 px-4 py-2.5">
                <Link to={`/assets?department=${row._id || ''}`} className="min-w-0 flex-1 truncate text-sm text-ink hover:underline">
                  {row.name}
                </Link>
                <span className="font-mono text-sm text-muted tabular">{row.count}</span>
              </li>
            ))}
            {!data?.byDepartment?.length && <li className="px-4 py-8 text-center text-sm text-muted">No departments yet</li>}
          </ul>
        </Card>

        <Card>
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">By owning company</h3>
            <p className="mt-0.5 text-xs text-muted">Read from the tag prefix</p>
          </div>
          <ul className="divide-y divide-line">
            {(data?.byEntity || []).map((row) => (
              <li key={row.name} className="flex items-center gap-3 px-4 py-2.5">
                <Link to={`/assets?entity=${encodeURIComponent(row.name)}`} className="min-w-0 flex-1 truncate text-sm text-ink hover:underline">
                  {row.name}
                </Link>
                <span className="font-mono text-sm text-muted tabular">{row.count}</span>
              </li>
            ))}
            {!data?.byEntity?.length && <li className="px-4 py-8 text-center text-sm text-muted">Nothing yet</li>}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-ink">Recent activity</h3>
              <p className="mt-0.5 text-xs text-muted">Every change, newest first</p>
            </div>
            {can('audit:read') && <Link to="/history" className="text-xs font-medium text-brand hover:underline">Full history</Link>}
          </div>
          <div className="px-4 py-2">
            <HistoryTrail entries={data?.recent} emptyIcon={ShieldCheck} dense />
          </div>
        </Card>

        {data?.topHolders?.length > 0 && (
          <Card>
            <div className="border-b border-line px-4 py-3">
              <h3 className="text-sm font-semibold text-ink">Holding the most</h3>
              <p className="mt-0.5 text-xs text-muted">People with assets checked out</p>
            </div>
            <ul className="divide-y divide-line">
              {data.topHolders.map((h) => (
                <li key={h._id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{h.name}</span>
                    {h.department && <span className="block truncate text-xs text-muted">{h.department}</span>}
                  </span>
                  <span className="font-mono text-sm font-medium text-ink tabular">{h.count}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
