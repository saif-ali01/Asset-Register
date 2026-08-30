import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2, ChevronDown, ChevronRight, ShieldAlert, ShieldCheck,
} from 'lucide-react';
import { Badge, Button, Card, SectionHeader, Skeleton } from '../components/ui/primitives.jsx';
import { AssetTag } from '../components/ui/data.jsx';
import { useApi } from '../hooks/useApi.js';
import { cx, dateTime } from '../lib/format.js';

const TONE = { high: 'danger', medium: 'amber', low: 'neutral' };
const SEVERITY_LABEL = { high: 'Fix first', medium: 'Worth fixing', low: 'Tidy-up' };

function AssetChips({ assets }) {
  if (!assets?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {assets.map((a) => (
        <Link key={a._id} to={`/assets/${a._id}`} title={a.name} className="hover:opacity-80">
          <AssetTag value={a.tag} />
        </Link>
      ))}
    </div>
  );
}

function Check({ check }) {
  const [open, setOpen] = useState(check.severity === 'high' && check.count > 0);
  const clear = check.count === 0;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <Card className={cx('overflow-hidden', clear && 'opacity-70')}>
      <button
        type="button"
        onClick={() => !clear && setOpen((o) => !o)}
        className={cx('flex w-full items-start gap-3 px-4 py-3 text-left', !clear && 'hover:bg-raised')}
        aria-expanded={open}
      >
        <span className="mt-0.5 shrink-0">
          {clear
            ? <CheckCircle2 size={18} className="text-brand" />
            : <ShieldAlert size={18} className={check.severity === 'high' ? 'text-danger' : 'text-amber'} />}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-ink">{check.title}</span>
            {clear ? (
              <Badge tone="brand">Clear</Badge>
            ) : (
              <>
                <Badge tone={TONE[check.severity]}>{SEVERITY_LABEL[check.severity]}</Badge>
                <span className="font-mono text-xs text-muted tabular">
                  {check.count}
                  {check.affected && check.affected !== check.count ? ` · ${check.affected} assets` : ''}
                </span>
              </>
            )}
          </span>
          <span className="mt-1 block text-xs leading-snug text-muted">{check.why}</span>
        </span>

        {!clear && <Chevron size={16} className="mt-0.5 shrink-0 text-faint" />}
      </button>

      {open && !clear && (
        <div className="space-y-3 border-t border-line bg-raised px-4 py-3">
          {/* Grouped by the repeated value: serials, holder names */}
          {check.groups?.map((g) => (
            <div key={g.value} className="rounded-md border border-line bg-surface p-2.5">
              <p className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="font-mono font-medium text-ink">{g.value}</span>
                <span className="text-xs text-muted">on {g.count} asset(s)</span>
              </p>
              <AssetChips assets={g.assets} />
            </div>
          ))}

          {/* Flat asset lists */}
          {check.assets?.length > 0 && (
            <div>
              <AssetChips assets={check.assets} />
              {check.count > check.assets.length && (
                <p className="mt-2 text-xs text-faint">
                  Showing {check.assets.length} of {check.count}.
                </p>
              )}
            </div>
          )}

          {/* Status conflicts come in two directions */}
          {check.heldWithoutHolder?.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-ink">Checked out, but nobody named</p>
              <AssetChips assets={check.heldWithoutHolder} />
            </div>
          )}
          {check.idleWithHolder?.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-ink">Not checked out, yet still points at a holder</p>
              <AssetChips assets={check.idleWithHolder} />
            </div>
          )}

          {/* Spelling variants in the lists */}
          {check.variants?.length > 0 && (
            <ul className="space-y-1.5">
              {check.variants.map((v, i) => (
                <li key={i} className="rounded-md border border-line bg-surface px-2.5 py-2 text-sm">
                  <span className="text-xs uppercase tracking-wide text-faint">{v.kind}</span>
                  <span className="mt-0.5 block text-ink">{v.names.join('  ·  ')}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Unused or handler-less list entries */}
          {check.entries?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {check.entries.map((e, i) => (
                <span key={i} className="rounded border border-line bg-surface px-2 py-0.5 text-xs text-muted">
                  <span className="text-faint">{e.kind}</span> {e.name}
                </span>
              ))}
            </div>
          )}

          {check.key === 'lookup_variants' && (
            <p className="text-xs text-muted">
              Merge these in <Link to="/settings" className="font-medium text-brand hover:underline">Settings</Link>:
              rename one to match the other, move any assets across, then remove the empty entry.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

export function DataQuality() {
  const { data, loading, reload } = useApi('/quality');

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-card" />)}
      </div>
    );
  }

  const s = data?.summary || {};
  const allClear = s.checksFailing === 0;

  return (
    <div className="space-y-4">
      <SectionHeader
        eyebrow="Housekeeping"
        title="Data quality"
        description="Checks that catch the things a hand-kept register drifts into. Nothing here is corrected automatically — it tells you what to look at."
        actions={<Button onClick={reload}>Run again</Button>}
      />

      <Card className={cx('flex flex-wrap items-center gap-4 p-4', allClear && 'border-brand/40 bg-brand-soft')}>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface">
          {allClear ? <ShieldCheck size={20} className="text-brand" /> : <ShieldAlert size={20} className="text-amber" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">
            {allClear
              ? 'Every check passed.'
              : `${s.checksFailing} of ${s.checksRun} checks found something.`}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {data?.totalAssets} asset(s) checked · {data?.checkedAt ? dateTime(data.checkedAt) : ''}
          </p>
        </div>
        {!allClear && (
          <div className="flex gap-1.5">
            {s.high > 0 && <Badge tone="danger">{s.high} to fix first</Badge>}
            {s.medium > 0 && <Badge tone="amber">{s.medium} worth fixing</Badge>}
            {s.low > 0 && <Badge tone="neutral">{s.low} tidy-up</Badge>}
          </div>
        )}
      </Card>

      <div className="space-y-2.5">
        {(data?.checks || []).map((check) => <Check key={check.key} check={check} />)}
      </div>
    </div>
  );
}
