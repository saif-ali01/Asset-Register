# Asset Register

A MERN asset-tracking app built directly from a real, 820-row IT asset register
(Asset_Tracker.xlsx) rather than a generic template. Every schema decision below
was reconciled against that workbook's own numbers before being written down —
see **Reconciliation** for the receipts.

---

## Stack

| Layer | Choice |
| --- | --- |
| Database | MongoDB + Mongoose 8 |
| API | Node 20+, Express 4, ES modules |
| Auth | JWT access tokens + rotating refresh tokens in httpOnly cookies |
| Validation | Zod, at the route boundary |
| Client | React 18, Vite 5, Tailwind 3, React Router 6, Recharts |

---

## Running it

```bash
# 1. MongoDB (or point MONGO_URI at Atlas)
docker compose up -d

# 2. API
cd server
cp .env.example .env          # then set the two JWT secrets
npm install

# Load your own register:
npm run import -- /path/to/Asset_Tracker.xlsx --dry-run   # preview first, writes nothing
npm run import -- /path/to/Asset_Tracker.xlsx --fresh     # then actually load it

# Or load synthetic demo data instead:
npm run seed -- --fresh

npm run dev                    # http://localhost:5000/api

# 3. Client — new terminal
cd client
cp .env.example .env
npm install
npm run dev                    # http://localhost:5173
```

Generate a JWT secret with:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## What the workbook actually contains

The uploaded file was a live 820-row register (`Asset Register` sheet, plus its
own `Summary Dashboard` and `Lists` sheets) exported from AssetTiger. Before
writing any schema I read it properly: fill rates and cardinality on every
column, the tag-prefix scheme, the status vocabulary, and which columns
determine which others. Three findings changed the design:

**1. Site determines Handler, with zero exceptions across 820 rows.**
Every one of the 24 sites maps to exactly one of four handlers (Aalok, Ankit,
Ashish, Vikash). That's not a coincidence to store per-asset — it's a property
of the site. So **Handler lives on the Site record**, not on every asset, and
the dashboard's "By site" table is a direct read of the same pivot the
workbook's own Summary Dashboard already computes.

**2. "Assigned to" names a person only when the asset is Checked Out.**
The invariant holds perfectly: all 586 `Checked Out` rows name someone, and no
other status ever does. So custody is enforced the same way — checking an
asset out requires a real user account, and any status change away from
Checked Out clears the holder. But roughly one row in ten actually names a
**site** ("HO / Noida"), a **department** ("IT Department"), or an owning
**entity** (VKC/Auro/VFI), not a person. Those are classified and kept as
`assignedToLabel` and a note rather than forced into `assignedTo`, which is why
`assignedToLabel` exists as a separate field from the linked user.

**3. The tag prefix encodes the owning company and the asset type.**
`VKCLT042`, `AuroPC011`, `VFILT003` — the register runs five group entities
through one asset numbering scheme, and the middle letters (`LT`, `PC`, `PH`,
`BM`…) are a de facto category code with zero exceptions once spelling variants
are folded together. `entity` and a tag-based category fallback both exist
because of this.

Other things the data made unavoidable:

- **Serial numbers are not unique.** 38 built-to-order desktops share the
  literal value `"Assemble"`, and a handful of phones share an IMEI-looking
  string. A unique index would have rejected 72 real rows. Instead, placeholder
  values (`Assemble`, `12345678`, `n/a`, …) are recognised and kept out of the
  serial field entirely, and genuine duplicates are surfaced by the Data
  Quality report rather than blocked at write time.
- **Categories and departments carry spelling variants** — `BAR CODE SCANNER` /
  `Barcode Scanner`, `HR Admin IT` / `HR, Admin & IT` / `HR` all mean the same
  thing. A canonicalisation table (`config/reference.js`) folds these on
  import; anything it doesn't recognise is still kept, title-cased, so nothing
  from an unfamiliar sheet is silently dropped.
- **Not every "Department" cell is a department.** Two rows say "Receipt
  Printer" and "Walnut ConfrenceRoom" — clearly not organisational units. These
  are recognised and kept as notes instead of becoming bogus department
  records.
- **The register doesn't track purchase cost at all.** Every purchase and
  warranty field exists and works, but nothing in the workbook populates them,
  so the dashboard shows "closed out" (disposed/sold/donated/lost) instead of
  a purchase-value tile when no asset actually carries a cost — a money figure
  that's always ₹0 is worse than no figure.

---

## Reconciliation

Rather than assert the mapping is correct, it's checked against numbers the
workbook itself already computed. `server/src/seed/analyse.js` is a pure
function (no database) that parses the sheet; running it against
`Asset_Tracker.xlsx` and comparing to the workbook's own `Summary Dashboard`
tab:

```
Status normalisation vs the workbook's own Summary Dashboard:
  PASS  available       82 (dashboard says 82)
  PASS  checked_out    586 (dashboard says 586)
  PASS  under_repair    11 (dashboard says 11)
  PASS  leased           8 (dashboard says 8)
  PASS  lost_missing     7 (dashboard says 7)
  PASS  donated          2 (dashboard says 2)
  PASS  sold             2 (dashboard says 2)
  PASS  disposed       122 (dashboard says 122)
  PASS  TOTAL          820 (dashboard says 820)

Handler -> sites (dashboard: Aalok 157, Ankit 409, Ashish 106, Vikash 148):
  PASS  Aalok    157   PASS  Ankit    409   PASS  Ashish   106   PASS  Vikash   148
```

Every figure the app derives from your raw rows matches the total your own
dashboard sheet already reports. Run it yourself:

```bash
cd server
npm run import -- /path/to/Asset_Tracker.xlsx --dry-run
```

This prints the same breakdown — status counts, handler/site counts, dimension
counts, and every data-quality warning — without writing anything.

---

## Importing your register

Two ways in, depending on how much control you want.

**`npm run import -- file.xlsx [--fresh] [--dry-run]`** — purpose-built for
this workbook's exact column layout (`Asset Tag ID`, `Assigned to`, `Handler`,
etc). It additionally:
- creates a **manager** account for each Handler, so every site has a real,
  working owner from the first login;
- creates a **dormant** account for each of the ~379 named holders — enough for
  custody to point at a real record, but not 379 live logins on a shared
  password. Activate one in **People** when that person actually needs access;
- opens a custody record for every asset that's currently checked out, so
  check-in works immediately, with no "opening balance" step to do by hand.

**Assets → Import in the UI** — the general-purpose path for any spreadsheet,
including future exports that don't look exactly like this one. Two steps:
read the headers and propose a mapping (exact alias match first, then a
conservative fuzzy match that requires ~70% of the header to overlap the
alias — enough to catch `Serial No.` for `serialNumber`, not enough to
mistake `Custodian Signature` for a holder column); confirm or correct each
guess; then commit, with **dry run** available to validate without writing.
Unmapped columns are kept in `customFields`, so nothing from an unfamiliar
sheet disappears.

Both paths share the same parsing (`config/reference.js`, `seed/analyse.js`),
so a dry run and the real import always agree.

---

## Data quality (Settings → Data quality)

Rather than silently "fixing" messy input, importing surfaces what it found so
a person can decide. Nine checks run over the live register:

| Check | What it catches |
| --- | --- |
| Status disagrees with holder | An asset checked out with nobody named, or vice versa |
| Duplicate serials | Real duplicates, with placeholders already excluded |
| Unmatched holders | Text names with no matching account — split into person / site / department |
| Placeholder serials | Values like `Assemble` or `12345678` sitting in the serial field |
| Missing serials | No identifier at all — worst on portable, high-theft-risk categories |
| Missing category | Assets that will silently disappear from every breakdown |
| List spelling variants | Two entries that are really one thing, splitting the counts |
| Unused list entries | Categories/departments/sites nothing points at |
| Sites with no handler | A site with no named owner for its hardware |

Each check explains *why* it matters, not just that it fired, and links
straight to the affected assets.

---

## Permissions

Roles are bundles of `resource:action` permissions:

```
effective rights = role bundle + extraPermissions − deniedPermissions
```

That third term does the real work — one person gains or loses a single right
without inventing a new role. Editable per person in **People → Edit →
Fine-tune permissions**.

| Role | Can |
| --- | --- |
| **Super admin** | Everything, including role definitions and permanent deletes |
| **Admin** | Everything except changing role definitions |
| **Manager** | Add/edit assets, check in/out, manage lists, read history — the role given to each imported Handler |
| **Technician** | Edit assets, check in/out, run maintenance — cannot create or delete |
| **Auditor** | Read everything and export. Changes nothing |
| **Employee** | Sees only the assets checked out to them |

Enforced in three places: `authorize('asset:update')` on the route (the real
gate), self-scoping in the query layer (an employee's `GET /assets` is
filtered server-side, not just hidden in the UI), and `<Can permission="…">`
in the client so people aren't shown controls that would fail.

---

## History

`AuditLog` is append-only. Every write goes through `recordAudit`, storing
actor, action, target and a **field-level diff** — old value, new value, per
field. Custody is tracked separately in `Assignment`: one row per check-out,
closed on check-in, with condition and notes recorded both directions. "Who
had VKCLT042 in March, and what state was it in when they gave it back" is a
lookup, not an investigation.

---

## Interface

One codebase, two shapes. Desktop: collapsible left rail, dense sortable
tables, ⌘K search, multi-select with a bulk-edit bar. Mobile: bottom tab bar
within thumb reach, tables collapsing into cards, dialogs becoming bottom
sheets. Light and dark are both first-class via CSS custom properties, resolved
before first paint so a reload in dark mode never flashes white.

Asset tags render as printed-label chips with a barcode tick strip, in IBM
Plex Mono — the app's one signature visual element, used everywhere a tag
appears. Status labels use the register's own words (`Checked Out`, not
`Assigned`) so nobody has to relearn their process to read the screen.

---

## API

All routes under `/api`. Everything except `/health` and `/auth/*` needs
`Authorization: Bearer <accessToken>`.

| Method | Path | Permission |
| --- | --- | --- |
| POST | `/auth/register` `/auth/login` `/auth/refresh` `/auth/logout` | — |
| GET PATCH | `/auth/me` | signed in |
| POST | `/auth/change-password` | signed in |
| GET | `/dashboard` | `dashboard:read` |
| GET | `/quality` | `asset:update` |
| GET POST | `/assets` | `asset:read` / `asset:create` |
| GET PATCH DELETE | `/assets/:id` | `asset:read` / `asset:update` / `asset:delete` |
| POST | `/assets/bulk` `/assets/:id/restore` | `asset:update` |
| GET | `/assignments` | `assignment:read` |
| POST | `/assignments/checkout` `/assignments/:id/transfer` | `assignment:checkout` |
| POST | `/assignments/:id/checkin` | `assignment:checkin` |
| GET POST PATCH DELETE | `/maintenance` | `maintenance:read` / `maintenance:write` |
| GET POST PATCH DELETE | `/lookups/:resource` | `lookup:read` / `lookup:write` |
| GET POST PATCH DELETE | `/users` | `user:read` / `user:write` / `user:delete` |
| GET | `/audit` `/audit/actions` | `audit:read` |
| GET | `/data/export` `/data/template` | `asset:export` / `asset:import` |
| POST | `/data/import/preview` `/data/import/commit` | `asset:import` |

`:resource` is `categories`, `departments`, `sites` or `vendors`.

---

## Data model

- **Asset** — `tag` (printed form, e.g. `AuroLT001`) + `tagKey` (uppercase,
  unique); `entity` (owning company, read from the prefix); `category`,
  `subCategory`, `department`, `site`; `status` in the register's own eight
  values; `assignedTo` (linked account) alongside `assignedToLabel` (the raw
  text, kept even when nothing links); serial number **not** unique;
  `customFields` for anything a sheet has that the schema doesn't.
- **Site** — a premises: name, city, `handler` (one owning account, per the
  workbook's own invariant), kind (head office / factory / retail / …).
- **Department, Category, Vendor** — simple lookups, each with an `aliases`
  field for spelling variants folded in during import.
- **Assignment** — one row per custody event: who, by whom, out when, due
  when, condition and notes both directions.
- **Maintenance** — type, status, schedule, cost, vendor, technician,
  resolution. Completing a repair returns the asset to `available`
  automatically.
- **AuditLog** — append-only, field-level diffs.
- **User** — role, permission overrides, activity state, lockout counters.

Deletes are soft by default; archiving keeps full history and can be restored.
Only a super admin can hard-delete, and only via `?hard=true`.

---

## Security notes

- Passwords: bcrypt cost 12, never selected by default.
- Access tokens short-lived (15 min); refresh tokens stored hashed, rotate on
  every use, revoked on password change, role change or deactivation.
- Six failed sign-ins locks an account for 15 minutes.
- Helmet, CORS allow-list, rate limits (20/15min on auth, 300/min elsewhere).
- Zod validation at the boundary; regex input escaped; sort fields
  allow-listed.
- Imported "holder" accounts are created **inactive** with a random,
  never-communicated password — they exist so custody has something to point
  at, not as 379 live logins on one shared credential.

---

## Things worth doing next

1. **Tests as a committed suite.** The permission resolver, importer parsers,
   header mapper and workbook analyser were all verified against real
   fixtures during development, but as ad-hoc scripts rather than a checked-in
   Vitest suite.
2. **Photo storage.** `Asset Photo` currently stores the AssetTiger CDN URL
   as-is; a re-upload path to your own storage would outlive that vendor.
3. **Bulk holder activation.** Turning on the ~379 dormant accounts is one at
   a time in People today; a bulk-activate-by-department action would help
   during rollout.
4. **Barcode/QR scanning** on mobile — tags are already designed for it.
5. **Scheduled reminders** for warranty expiry and overdue returns.
