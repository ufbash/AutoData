# BRIEF_WRITE_PATH.md

**Status note (added 9 Sep 2026, reconciliation pass):** this is a point-in-time diagnostic
dated 4 Sep 2026, kept as historical evidence per this project's convention of preserving
investigation records rather than deleting superseded ones. Its open question — do
`max_budget_usd`/`titles_accepted` reach the database, or does something drop them — is
**resolved**: `PLAN_TRACKER.md` §1.1 (Q1) confirms, via a real browser round-trip on
4 Sep 2026, that both fields (and all sixteen) save and reload correctly; nothing was
dropping them. `ClientsList.tsx` has also changed substantially since this was written —
Prompt 18 Phase 6 (6 Sep 2026) replaced several of the free-text inputs quoted below
(transmission, fuel, condition, titles, interior, payment) with closed dropdowns/multi-selects
and added the intake-form-parity fields — so the file:line references and the "16 columns"
framing below describe the form as it was on 4 Sep, not as it is now. For the current shape,
see `SCHEMA.md` §10 and `PLAN_TRACKER.md` §4.6's parity table. Left unedited below as the
original diagnostic record.

---

Diagnostic only. No source files, migrations, or git state were changed to produce this
document. All code below is quoted verbatim from the working tree at the time of writing.

---

## Section 1 — The write path, quoted in full

Source: `src/services/researchService.ts`

### `listClientBriefs` (lines 196-211)
```ts
export const listClientBriefs = async (orgId: string, clientId?: string): Promise<ClientBrief[]> => {
  let q = supabase
    .from('client_briefs')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  
  if (clientId) {
    q = q.eq('client_id', clientId);
  }

  const { data, error } = await q;
  if (error) throw new Error(`Failed to list client briefs: ${error.message}`);
  return data || [];
};
```

### `createClientBrief` (lines 213-222)
```ts
export const createClientBrief = async (orgId: string, clientId: string, brief: Partial<ClientBrief>): Promise<ClientBrief> => {
  const { data, error } = await supabase
    .from('client_briefs')
    .insert({ ...brief, org_id: orgId, client_id: clientId })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create client brief: ${error.message}`);
  return data;
};
```

### `updateClientBrief` (lines 236-246)
```ts
export const updateClientBrief = async (briefId: string, patch: Partial<ClientBrief>): Promise<ClientBrief> => {
  const { data, error } = await supabase
    .from('client_briefs')
    .update(patch)
    .eq('id', briefId)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update client brief: ${error.message}`);
  return data;
};
```

### `softDeleteClientBrief` (lines 285-295)
```ts
export const softDeleteClientBrief = async (briefId: string, userId: string): Promise<void> => {
  const { error } = await supabase
    .from('client_briefs')
    .update({ 
      deleted_at: new Date().toISOString(),
      deleted_by: userId
    })
    .eq('id', briefId);

  if (error) throw new Error(`Failed to delete client brief: ${error.message}`);
};
```

### `listDeletedClientBriefs` (lines 321-335)
```ts
export const listDeletedClientBriefs = async (orgId: string): Promise<ClientBrief[]> => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data, error } = await supabase
    .from('client_briefs')
    .select('*')
    .eq('org_id', orgId)
    .not('deleted_at', 'is', null)
    .gte('deleted_at', thirtyDaysAgo.toISOString())
    .order('deleted_at', { ascending: false });

  if (error) throw new Error(`Failed to list deleted briefs: ${error.message}`);
  return data || [];
};
```

### `restoreClientBrief` (lines 337-343)
```ts
export const restoreClientBrief = async (briefId: string): Promise<void> => {
  const { error } = await supabase
    .from('client_briefs')
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', briefId);
  if (error) throw new Error(`Failed to restore brief: ${error.message}`);
};
```

**Observation from these six functions alone:** `createClientBrief` inserts `{ ...brief, org_id, client_id }` with no field allow-list or field-by-field destructuring. `updateClientBrief` passes `patch` straight into `.update()` with no allow-list either. `listClientBriefs` and `listDeletedClientBriefs` both `select('*')` — no column is excluded from what comes back. There is no allow-list mechanism in this file comparable to the `public-run` allow-list described in AGENTS.md §4.5.

---

## Section 2 — The form state path, quoted

Source: `src/components/ClientsList.tsx`

### `BriefForm` state initialisation (lines 7-18)
```tsx
const BriefForm = ({ 
  initialData = { quantity: 1 }, 
  onSubmit, 
  onCancel, 
  isSubmitting 
}: { 
  initialData?: Partial<ClientBrief>, 
  onSubmit: (data: Partial<ClientBrief>) => void, 
  onCancel: () => void, 
  isSubmitting: boolean 
}) => {
  const [formData, setFormData] = useState<Partial<ClientBrief>>(initialData);
```
For a new brief the default shape is `{ quantity: 1 }` — every other `ClientBrief` key is simply absent from the object until an `onChange` handler sets it.

### Submit handler inside `BriefForm` (lines 20-23)
```tsx
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };
```
The exact object passed upward is `formData` — the whole form-state object, unfiltered.

### Caller — create path (lines 236-254)
```tsx
  const handleCreateBrief = async (data: Partial<ClientBrief>) => {
    if (!orgId || !selectedClient) return;
    setCreatingBrief(true);
    try {
      const b = await createClientBrief(orgId, selectedClient.id, {
        ...data,
        quantity: data.quantity || 1,
        transmission: data.transmission === 'either' ? 'either' : data.transmission,
        fuel_type: data.fuel_type === 'either' ? 'either' : data.fuel_type,
        condition_required: data.condition_required === 'either' ? 'either' : data.condition_required,
      });
      setBriefs([b, ...briefs]);
      setShowNewBriefForm(false);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCreatingBrief(false);
    }
  };
```

### Caller — update path (lines 256-273)
```tsx
  const handleUpdateBrief = async (data: Partial<ClientBrief>) => {
    if (!editingBriefId) return;
    setCreatingBrief(true);
    try {
      const b = await updateClientBrief(editingBriefId, {
        ...data,
        transmission: data.transmission === 'either' ? 'either' : data.transmission,
        fuel_type: data.fuel_type === 'either' ? 'either' : data.fuel_type,
        condition_required: data.condition_required === 'either' ? 'either' : data.condition_required,
      });
      setBriefs(briefs.map(br => br.id === editingBriefId ? b : br));
      setEditingBriefId(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setCreatingBrief(false);
    }
  };
```
Both handlers spread `...data` (the entire `formData` object from `BriefForm`) and only explicitly override `quantity`, `transmission`, `fuel_type`, `condition_required`. No key is deleted or excluded from the spread.

### JSX wiring — where `initialData` comes from in edit mode (lines 351, 636-643)
```tsx
  const selectedBrief = selectedBriefId ? briefs.find(b => b.id === selectedBriefId) : null;
```
```tsx
              {isSelectedBriefEditing && selectedBrief && (
                <BriefForm 
                  initialData={selectedBrief}
                  onSubmit={handleUpdateBrief} 
                  onCancel={() => { setEditingBriefId(null); setSelectedBriefId(selectedBrief.id); }} 
                  isSubmitting={creatingBrief} 
                />
              )}
```
`initialData` in edit mode is `selectedBrief`, i.e. the raw row object as returned by `listClientBriefs`'s `select('*')` (Section 1). There is no per-field mapping function between the DB row and form state — `useState<Partial<ClientBrief>>(initialData)` (line 18) takes the row directly.

---

## Section 3 — The four-way column table

Live columns (`supabase db query "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'client_briefs' ORDER BY ordinal_position;" --linked -o table`):

```
id (uuid), client_id (uuid), org_id (uuid), make (text), model (text), trim (text),
year_min (integer), year_max (integer), max_mileage (integer), transmission (text),
fuel_type (text), condition_required (text), titles_accepted (ARRAY),
colour_preference (text), interior_preference (text), quantity (integer),
max_budget_usd (numeric), max_bid_usd (numeric), additional_notes (text),
created_at (timestamptz), created_by (uuid), deleted_at (timestamptz), deleted_by (uuid)
```

| Column | Rendered as an input? (file:line or NO) | Present in create payload? | Present in update payload? | Read back into edit-mode state? |
|---|---|---|---|---|
| id | system-managed (PK, server-generated) | n/a | n/a | n/a |
| org_id | system-managed (set by `createClientBrief`, `researchService.ts:216`: `org_id: orgId`) | yes, added by service layer, not the form | n/a (never in `patch`) | n/a |
| client_id | system-managed (set by `createClientBrief`, `researchService.ts:216`: `client_id: clientId`) | yes, added by service layer, not the form | n/a | n/a |
| created_at | system-managed (DB default) | n/a | n/a | n/a |
| created_by | system-managed (column exists but no code in `researchService.ts` or `ClientsList.tsx` sets it on insert) | not set by app code | n/a | n/a |
| deleted_at | system-managed (`softDeleteClientBrief`, `researchService.ts:289`; `restoreClientBrief`, `researchService.ts:340`) | n/a | n/a | n/a |
| deleted_by | system-managed (`softDeleteClientBrief`, `researchService.ts:290`; `restoreClientBrief`, `researchService.ts:340`) | n/a | n/a | n/a |
| make | YES, `ClientsList.tsx:35` (`value={formData.make \|\| ''}`) | yes — part of `...data` spread, `ClientsList.tsx:240-241` | yes — part of `...data` spread, `ClientsList.tsx:260-261` | yes — `selectedBrief.make` is part of the raw row spread into `initialData`, `ClientsList.tsx:638` |
| model | YES, `ClientsList.tsx:39` | yes — `...data` spread | yes — `...data` spread | yes — raw row spread |
| trim | YES, `ClientsList.tsx:44` | yes — `...data` spread | yes — `...data` spread | yes — raw row spread |
| quantity | YES, `ClientsList.tsx:48` | yes — explicitly set, `ClientsList.tsx:242`: `quantity: data.quantity \|\| 1` | yes — part of `...data` spread (no override in update handler) | yes — raw row spread |
| year_min | YES, `ClientsList.tsx:54` | yes — `...data` spread | yes — `...data` spread | yes — raw row spread |
| year_max | YES, `ClientsList.tsx:58` | yes — `...data` spread | yes — `...data` spread | yes — raw row spread |
| max_mileage | YES, `ClientsList.tsx:64` | yes — `...data` spread | yes — `...data` spread | yes — raw row spread |
| transmission | YES, `ClientsList.tsx:69` (select) | yes — explicitly set, `ClientsList.tsx:243` | yes — explicitly set, `ClientsList.tsx:262` | yes — raw row spread |
| fuel_type | YES, `ClientsList.tsx:78` (select) | yes — explicitly set, `ClientsList.tsx:244` | yes — explicitly set, `ClientsList.tsx:263` | yes — raw row spread |
| condition_required | YES, `ClientsList.tsx:89` (select) | yes — explicitly set, `ClientsList.tsx:245` | yes — explicitly set, `ClientsList.tsx:264` | yes — raw row spread |
| colour_preference | YES, `ClientsList.tsx:100` | yes — `...data` spread | yes — `...data` spread | yes — raw row spread |
| interior_preference | YES, `ClientsList.tsx:105` | yes — `...data` spread | yes — `...data` spread | yes — raw row spread |
| max_budget_usd | YES, `ClientsList.tsx:110` | structurally yes (part of `...data` spread) — see empty-numeric caveat below | structurally yes (part of `...data` spread) | yes — raw row spread |
| max_bid_usd | YES, `ClientsList.tsx:115` | structurally yes (part of `...data` spread) — same caveat | structurally yes (part of `...data` spread) | yes — raw row spread |
| titles_accepted | YES, `ClientsList.tsx:120` | structurally yes (part of `...data` spread) — see array-conversion note below | structurally yes (part of `...data` spread) | yes — raw row spread, then re-joined to a string for display (`ClientsList.tsx:120`) |
| additional_notes | YES, `ClientsList.tsx:128` (textarea) | yes — `...data` spread | yes — `...data` spread | yes — raw row spread |

### Dropped-field list

No column that is rendered as an input fails, in the current code, to be included in the object
passed to `createClientBrief`/`updateClientBrief`, and no column is excluded when `selectedBrief`
(from `select('*')`, Section 1) is used as `initialData` for edit mode. Every one of the 16
user-facing columns is carried by unfiltered object spreads (`{ ...brief, ... }` in
`createClientBrief`, `.update(patch)` in `updateClientBrief`, `{ ...data, ... }` in both
`ClientsList.tsx` handlers) rather than by field-by-field mapping, so there is no line of code
that names a field and omits it.

**This says only that no *structural* allow-list or mapping bug exists in the current tree.** It
does not say every field reliably reaches a non-null value in the database — see the
`titles_accepted` and empty-numeric-input caveats below, and Section 4's live-data check.

---

### `titles_accepted` — text[] via a comma-separated text input

Both conversions are on the same line, `ClientsList.tsx:120-123`:
```tsx
          <input type="text" value={formData.titles_accepted?.join(', ') || ''} onChange={e => {
            const vals = e.target.value.split(',').map(v => v.trim()).filter(Boolean);
            setFormData({...formData, titles_accepted: vals.length > 0 ? vals : undefined});
          }} className="w-full px-3 py-2 text-sm border border-gray-300 rounded" placeholder="clean, salvage" />
```
- **Array → string (read/display):** `formData.titles_accepted?.join(', ') || ''` — used both to render the current state and, since `formData` is initialised directly from the DB row (`useState<Partial<ClientBrief>>(initialData)`, `ClientsList.tsx:18`), to render a loaded `text[]` value from the database.
- **String → array (write):** `e.target.value.split(',').map(v => v.trim()).filter(Boolean)`, then `vals.length > 0 ? vals : undefined`.

Both directions are present and symmetric in the current code: array-in renders as `join(', ')`, string-out is split and trimmed back into an array before being stored in `formData`. No asymmetry was found in this pair.

---

### Empty numeric input — what is actually sent

For `max_budget_usd`, the deciding line is `ClientsList.tsx:110`:
```tsx
<input type="number" value={formData.max_budget_usd || ''} onChange={e => setFormData({...formData, max_budget_usd: parseFloat(e.target.value) || undefined})} ... />
```
`parseFloat('')` is `NaN`, and `NaN || undefined` evaluates to `undefined`. So:
- **If the field is never touched in create mode:** `formData` starts as `{ quantity: 1 }` (`ClientsList.tsx:8`) — the `max_budget_usd` key is not present on the object at all. It is carried through `{...data, ...}` (`ClientsList.tsx:240-241`) as a still-absent key, and `supabase-js`/`JSON.stringify` drop absent/`undefined` keys from the request body, so the column is **omitted from the insert** and takes its Postgres default (`NULL`).
- **If the field is touched and then cleared:** `onChange` fires with `parseFloat('') || undefined` → `formData.max_budget_usd` becomes explicitly `undefined`. Same outcome on the wire: `JSON.stringify` drops `undefined`-valued keys, so it is again **omitted from the request**, not sent as `0` or `null`.
- **If the field is left with a previously-loaded DB value of `null` in edit mode:** `initialData` is the raw row, so `formData.max_budget_usd` is `null` (not absent). If untouched, `patch.max_budget_usd` is sent as an explicit `null` on update (a real key with value `null`, not omitted) — functionally the same end state in the column.

The same pattern (`parseFloat(...) || undefined` / `parseInt(...) || undefined`) applies identically to `max_bid_usd` (`ClientsList.tsx:115`), `year_min` (`ClientsList.tsx:54`), `year_max` (`ClientsList.tsx:58`), and `max_mileage` (`ClientsList.tsx:64`). `quantity` differs: it defaults via `parseInt(e.target.value) || 1` in the input (`ClientsList.tsx:48`) and is force-defaulted again in the create handler (`ClientsList.tsx:242`: `quantity: data.quantity || 1`), so an untouched/cleared `quantity` sends `1`, never omitted.

---

## Section 4 — Live data check

Command run:
```
supabase db query "SELECT id, client_id, make, model, trim, quantity, fuel_type, colour_preference, interior_preference, max_budget_usd, max_bid_usd, titles_accepted, condition_required, transmission, created_at FROM client_briefs ORDER BY created_at DESC LIMIT 10;" --linked -o table
```

Output (verbatim, 5 rows returned — the table currently holds only 5 rows total):
```
┌──────────────────────────────────────┬──────────────────────────────────────┬────────┬───────────────┬──────────────┬──────────┬───────────┬───────────────────┬─────────────────────┬────────────────┬─────────────┬─────────────────┬────────────────────┬──────────────┬───────────────────────────────┐
│                  id                  │              client_id               │  make  │     model     │     trim     │ quantity │ fuel_type │ colour_preference │ interior_preference │ max_budget_usd │ max_bid_usd │ titles_accepted │ condition_required │ transmission │          created_at           │
├──────────────────────────────────────┼──────────────────────────────────────┼────────┼───────────────┼──────────────┼──────────┼───────────┼───────────────────┼─────────────────────┼────────────────┼─────────────┼─────────────────┼────────────────────┼──────────────┼───────────────────────────────┤
│ 69802f12-30cd-4de4-af69-a81b2faf62dd │ 9e26aefd-2c22-4cf3-91d4-9eec2952b91e │ Toyota │ Yaris, Matrix │ NULL         │ 1        │ petrol    │ NULL              │ NULL                │ NULL           │ 1300        │ NULL            │ run_and_drive      │ automatic    │ 2026-08-28 19:16:52.104143+00 │
│ c9f93e90-6942-4f02-9cef-b27d3265acff │ 50a1f0fd-d7b5-45a3-b3dd-408e58d0dff4 │ Honda  │ Accord        │ 2.0 T, Sport │ 1        │ petrol    │ NULL              │ NULL                │ NULL           │ NULL        │ NULL            │ run_and_drive      │ automatic    │ 2026-08-26 22:08:28.737151+00 │
│ f156918f-6a83-408a-a56f-6c37f51d027b │ 456ef9a1-603e-4ba3-a98a-43b46298a872 │ BMW    │ 535i          │ M-Sport      │ 1        │ petrol    │ Any, except White │ Any                 │ NULL           │ NULL        │ NULL            │ run_and_drive      │ automatic    │ 2026-08-24 16:18:15.068138+00 │
│ 297467f4-a4b6-4851-84fa-7641dfa2869f │ 9e26aefd-2c22-4cf3-91d4-9eec2952b91e │ Toyota │ Yaris         │ NULL         │ 1        │ NULL      │ NULL              │ NULL                │ NULL           │ 2500        │ NULL            │ run_and_drive      │ automatic    │ 2026-08-05 03:55:29.271702+00 │
│ 5e1560d5-ceb5-42ee-a012-bedf0e9bdeb9 │ 9e26aefd-2c22-4cf3-91d4-9eec2952b91e │ Toyota │ Camry         │ NULL         │ 1        │ NULL      │ NULL              │ NULL                │ NULL           │ NULL        │ NULL            │ NULL               │ NULL         │ 2026-08-05 03:54:37.56548+00  │
└──────────────────────────────────────┴──────────────────────────────────────┴────────┴───────────────┴──────────────┴──────────┴───────────┴───────────────────┴─────────────────────┴────────────────┴─────────────┴─────────────────┴────────────────────┴──────────────┴───────────────────────────────┘
```

**Facts stated only, no interpretation beyond "consistent with":**
- `make`, `model`, `quantity`, `condition_required` are populated in every row that has any data at all (4 of 5; the 5th row, `5e1560d5...`, has `condition_required`/`transmission`/`fuel_type` all `NULL`).
- `trim` is populated in 2 of 5 rows (`2.0 T, Sport`, `M-Sport`) and `NULL` in the other 3.
- `fuel_type` is populated in 2 of 5 rows (`petrol`) and `NULL` in the other 3.
- `transmission` is populated in 4 of 5 rows (`automatic`) and `NULL` in the 5th.
- `colour_preference` and `interior_preference` are populated in exactly 1 of 5 rows (the BMW row: `Any, except White` / `Any`) and `NULL` in the other 4.
- `max_bid_usd` is populated in 2 of 5 rows (`1300`, `2500`) and `NULL` in the other 3.
- `max_budget_usd` is `NULL` in **all 5** rows.
- `titles_accepted` is `NULL` in **all 5** rows.

`max_budget_usd` and `titles_accepted` being null in every existing row is **consistent with** explanation (ii) (a value entered by a user that never reached the database) for those two columns specifically. It is equally **consistent with** no user having entered a value for those two fields in any of the 5 briefs created so far — the query cannot distinguish "never tried" from "tried and silently dropped." `colour_preference`/`interior_preference`/`trim`/`fuel_type` being populated in at least one row each shows those specific columns have successfully round-tripped through the current write path at least once.

Separately: `git log --follow -- src/components/ClientsList.tsx` shows exactly one commit touching this file, `612e1e8`, dated **2026-09-04** (today), and `git log --diff-filter=A -- src/components/ClientsList.tsx` shows the same commit as the file's addition to version control — the file did not exist in git history before today. The user's 5 August browser test therefore predates this file's presence in the repository under its current path/name; whatever form the user tested that day is not the code quoted in Sections 1-2 of this document, and this document cannot establish what that earlier code looked like.
