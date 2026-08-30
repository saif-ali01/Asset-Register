import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';
import {
  Button, Card, Field, IconButton, Input, Select, Textarea,
} from '../components/ui/primitives.jsx';
import { useApi } from '../hooks/useApi.js';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../lib/api.js';
import { CONDITIONS, DEPRECIATION_METHODS, ENTITIES, STATUSES, STATUS_META } from '../lib/constants.js';
import { titleCase } from '../lib/format.js';

const BLANK = {
  tag: '', name: '', description: '', category: '', subCategory: '', department: '',
  entity: '', brand: '', model: '', serialNumber: '',
  status: 'available', condition: '', site: '', vendor: '',
  purchaseDate: '', purchaseCost: '', currency: 'INR', invoiceNumber: '', poNumber: '',
  warrantyExpiry: '', amcExpiry: '', depreciationMethod: 'none', usefulLifeMonths: '',
  salvageValue: '', quantity: 1, unit: 'unit', notes: '',
};

const asDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');

function Group({ title, hint, children, cols = 2 }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      <div className={`grid gap-4 ${cols === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>{children}</div>
    </Card>
  );
}

export function AssetForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const [form, setForm] = useState(BLANK);
  /**
   * Custom fields are held as an ordered list of pairs rather than an object,
   * so a key can be renamed while it is being typed without React losing the
   * row's identity on every keystroke.
   */
  const [customFields, setCustomFields] = useState([]);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  const { data: existing, loading } = useApi(editing ? `/assets/${id}` : null, undefined, { enabled: editing });
  const { data: categories } = useApi('/lookups/categories');
  const { data: sites } = useApi('/lookups/sites');
  const { data: departments } = useApi('/lookups/departments');
  const { data: vendors } = useApi('/lookups/vendors');

  useEffect(() => {
    if (!existing?.asset) return;
    const a = existing.asset;
    setForm({
      ...BLANK,
      ...Object.fromEntries(Object.entries(a).filter(([k]) => k in BLANK)),
      category: a.category?._id || '',
      department: a.department?._id || '',
      site: a.site?._id || '',
      vendor: a.vendor?._id || '',
      purchaseDate: asDateInput(a.purchaseDate),
      warrantyExpiry: asDateInput(a.warrantyExpiry),
      amcExpiry: asDateInput(a.amcExpiry),
      purchaseCost: a.purchaseCost ?? '',
      usefulLifeMonths: a.usefulLifeMonths ?? '',
      salvageValue: a.salvageValue ?? '',
    });
    setCustomFields(Object.entries(a.customFields || {}).map(([key, value]) => ({ key, value })));
  }, [existing]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});

    // Send only what the user filled in; empty strings would clear real values.
    const payload = Object.fromEntries(
      Object.entries(form).filter(([, v]) => v !== '' && v !== null && v !== undefined)
    );

    // Rows with a blank name are dropped; a blank value is kept, since
    // "recorded but empty" is a real state for these.
    const named = customFields.filter((f) => f.key.trim());
    if (named.length) {
      payload.customFields = Object.fromEntries(named.map((f) => [f.key.trim(), String(f.value ?? '')]));
    } else if (editing && Object.keys(existing?.asset?.customFields || {}).length) {
      // All rows removed: send an empty object so the server clears them,
      // rather than omitting the key and leaving the old values in place.
      payload.customFields = {};
    }

    try {
      const saved = editing
        ? await api.patch(`/assets/${id}`, payload)
        : await api.post('/assets', payload);
      toast.success(editing ? `${saved.tag} saved` : `${saved.tag} added to the register`);
      navigate(`/assets/${saved._id}`, { replace: true });
    } catch (err) {
      setErrors(err.details || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (editing && loading) return <p className="py-10 text-center text-sm text-muted">Loading asset…</p>;

  return (
    <form onSubmit={submit} className="space-y-4 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" icon={ArrowLeft} onClick={() => navigate(-1)}>Back</Button>
          <div>
            <p className="eyebrow">{editing ? 'Edit' : 'New record'}</p>
            <h1 className="font-display text-xl font-bold tracking-tight text-ink">
              {editing ? form.name || 'Edit asset' : 'Add an asset'}
            </h1>
          </div>
        </div>
        <Button type="submit" variant="primary" icon={Save} loading={busy}>
          {editing ? 'Save changes' : 'Add to register'}
        </Button>
      </div>

      <Group title="Identity" hint="Leave the tag blank and the next sequential label is assigned automatically.">
        <Field label="Asset tag" error={errors.tag} hint={editing ? undefined : 'e.g. VKCLT275'}>
          <Input value={form.tag} onChange={set('tag')} placeholder="Auto-generated" className="font-mono" />
        </Field>
        <Field label="Name" error={errors.name} required>
          <Input required value={form.name} onChange={set('name')} placeholder="Dell Latitude 5450" invalid={Boolean(errors.name)} />
        </Field>
        <Field label="Category" error={errors.category}>
          <Select value={form.category} onChange={set('category')}>
            <option value="">Not set</option>
            {(categories?.items || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Serial number" error={errors.serialNumber} hint="Must be unique across the register.">
          <Input value={form.serialNumber} onChange={set('serialNumber')} className="font-mono" invalid={Boolean(errors.serialNumber)} />
        </Field>
        <Field label="Brand"><Input value={form.brand} onChange={set('brand')} placeholder="Dell" /></Field>
        <Field label="Model"><Input value={form.model} onChange={set('model')} placeholder="Latitude 5450" /></Field>
        <Field label="Sub category" hint="e.g. Laser printer. Optional.">
          <Input value={form.subCategory} onChange={set('subCategory')} />
        </Field>
        <Field label="Owning company" hint="Usually read from the tag prefix.">
          <Select value={form.entity} onChange={set('entity')}>
            <option value="">Not set</option>
            {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
          </Select>
        </Field>
        <Field label="Notes for this asset" className="sm:col-span-2">
          <Textarea value={form.description} onChange={set('description')} placeholder="Anything a future reader would need to know." />
        </Field>
      </Group>

      <Group title="Status and place" hint="Check-out and check-in change status on their own — set it here only for corrections.">
        <Field label="Status">
          <Select value={form.status} onChange={set('status')}>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </Select>
        </Field>
        <Field label="Condition" hint="Optional. Recorded on check-in.">
          <Select value={form.condition} onChange={set('condition')}>
            <option value="">Not recorded</option>
            {CONDITIONS.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
          </Select>
        </Field>
        <Field label="Site" hint="The handler is whoever owns hardware at this site.">
          <Select value={form.site} onChange={set('site')}>
            <option value="">Not set</option>
            {(sites?.items || []).map((l) => (
              <option key={l._id} value={l._id}>{l.name}{l.city ? ` — ${l.city}` : ''}</option>
            ))}
          </Select>
        </Field>
        <Field label="Department">
          <Select value={form.department} onChange={set('department')}>
            <option value="">Not set</option>
            {(departments?.items || []).map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
          </Select>
        </Field>
      </Group>

      <Group title="Purchase" cols={3} hint="Optional — the register does not currently track cost, and these can stay blank.">
        <Field label="Vendor">
          <Select value={form.vendor} onChange={set('vendor')}>
            <option value="">Not set</option>
            {(vendors?.items || []).map((v) => <option key={v._id} value={v._id}>{v.name}</option>)}
          </Select>
        </Field>
        <Field label="Purchase date"><Input type="date" value={form.purchaseDate} onChange={set('purchaseDate')} /></Field>
        <Field label="Purchase cost" error={errors.purchaseCost}>
          <Input type="number" min="0" step="0.01" value={form.purchaseCost} onChange={set('purchaseCost')} className="tabular" />
        </Field>
        <Field label="Currency"><Input value={form.currency} onChange={set('currency')} maxLength={3} className="font-mono" /></Field>
        <Field label="Invoice number"><Input value={form.invoiceNumber} onChange={set('invoiceNumber')} /></Field>
        <Field label="PO number"><Input value={form.poNumber} onChange={set('poNumber')} /></Field>
      </Group>

      <Group title="Cover and value" cols={3} hint="Book value on the asset page is calculated from these.">
        <Field label="Warranty expiry"><Input type="date" value={form.warrantyExpiry} onChange={set('warrantyExpiry')} /></Field>
        <Field label="AMC expiry"><Input type="date" value={form.amcExpiry} onChange={set('amcExpiry')} /></Field>
        <Field label="Depreciation method">
          <Select value={form.depreciationMethod} onChange={set('depreciationMethod')}>
            {DEPRECIATION_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Useful life (months)">
          <Input type="number" min="0" value={form.usefulLifeMonths} onChange={set('usefulLifeMonths')} className="tabular" />
        </Field>
        <Field label="Salvage value">
          <Input type="number" min="0" value={form.salvageValue} onChange={set('salvageValue')} className="tabular" />
        </Field>
        <Field label="Quantity">
          <Input type="number" min="0" value={form.quantity} onChange={set('quantity')} className="tabular" />
        </Field>
      </Group>

      <Group title="Notes" cols={1}>
        <Field label="Internal notes">
          <Textarea rows={4} value={form.notes} onChange={set('notes')} placeholder="Repairs, quirks, accessories included in the box." />
        </Field>
      </Group>

      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Custom fields</h3>
            <p className="mt-0.5 text-xs text-muted">
              Anything this register tracks that the form above has no place for — including columns
              carried over from a spreadsheet import. Editable here.
            </p>
          </div>
          <Button
            type="button" size="sm" icon={Plus}
            onClick={() => setCustomFields((f) => [...f, { key: '', value: '' }])}
          >
            Add field
          </Button>
        </div>

        {customFields.length === 0 ? (
          <p className="rounded-md border border-dashed border-line bg-raised px-3 py-6 text-center text-sm text-muted">
            No custom fields on this asset.
          </p>
        ) : (
          <ul className="space-y-2">
            {customFields.map((field, i) => (
              <li key={i} className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
                <Input
                  aria-label={`Custom field ${i + 1} name`}
                  placeholder="Field name"
                  value={field.key}
                  onChange={(e) => setCustomFields((list) =>
                    list.map((f, j) => (j === i ? { ...f, key: e.target.value } : f))
                  )}
                  className="w-full sm:w-1/3"
                />
                <Input
                  aria-label={`Custom field ${i + 1} value`}
                  placeholder="Value"
                  value={field.value}
                  onChange={(e) => setCustomFields((list) =>
                    list.map((f, j) => (j === i ? { ...f, value: e.target.value } : f))
                  )}
                  className="w-full flex-1"
                />
                <IconButton
                  label={`Remove ${field.key || 'this field'}`}
                  icon={Trash2}
                  onClick={() => setCustomFields((list) => list.filter((_, j) => j !== i))}
                  className="hover:text-danger"
                />
              </li>
            ))}
          </ul>
        )}

        {customFields.some((f) => !f.key.trim()) && (
          <p className="mt-2 text-xs text-amber">
            Rows without a field name are discarded when you save.
          </p>
        )}
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" onClick={() => navigate(-1)}>Cancel</Button>
        <Button type="submit" variant="primary" icon={Save} loading={busy}>
          {editing ? 'Save changes' : 'Add to register'}
        </Button>
      </div>
    </form>
  );
}
