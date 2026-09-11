-- PROMPT 28 Stage 2 (C1d) — currency on the rate tables.
--
-- Prompt 22 designed this and parked it deliberately: real Nigerian assessment notices are
-- denominated in Naira, and extract-cost-document's currency guard correctly abstains on every
-- monetary field in one, because rate_unit only ever offered usd|percent. The guard is right
-- and is NOT touched by this migration - the tables just need to be able to hold what the
-- documents actually say, once a human has looked at them.
--
-- Additive only. NOT NULL DEFAULT 'usd' on all three tables - every existing row is USD, so
-- the backfill is unambiguous and alters no existing amount. amount_usd/fx_rate/fx_rate_date
-- stay NULL for every USD row (nothing was converted, nothing to record) and are populated
-- only when a human confirms a non-USD row through the extraction review screen.
--
-- Frozen at confirmation, never recomputed at read (PROJECT_CHARTER.md S5.10's dated-rate
-- discipline, extended to currency): a rate row is a standing figure, current until superseded
-- by effective_from/effective_to - the same discipline this applies to price already, now
-- applied to the currency it was priced in. This is NOT sightings.exchange_rate's case
-- (SCHEMA.md S1) - a sighting freezes a rate because the underlying fact is historical and
-- immutable; a rate row is a standing figure that stays "current" until superseded, and
-- freezing the conversion at confirmation is the honest extension of that same discipline, not
-- a copy of a different one for a different reason.

alter table public.cost_rates
  add column currency text not null default 'usd',
  add column amount_usd numeric,
  add column fx_rate numeric,
  add column fx_rate_date date;

alter table public.trucking_rates
  add column currency text not null default 'usd',
  add column amount_usd numeric,
  add column fx_rate numeric,
  add column fx_rate_date date;

alter table public.auction_fee_brackets
  add column currency text not null default 'usd',
  add column amount_usd numeric,
  add column fx_rate numeric,
  add column fx_rate_date date;

-- An auditor must be able to reconstruct the conversion from the row alone: a non-USD row
-- must carry all three (amount_usd, fx_rate, fx_rate_date) together, or none of them (a USD
-- row, or a percent-unit auction_fee_brackets row, which has no currency dimension to convert
-- at all - fee_unit='percent' rows always stay currency='usd' with these three null,
-- regardless of what the source document's absolute figures were denominated in, since the
-- stored value is a rate, not an amount).
alter table public.cost_rates
  add constraint cost_rates_currency_conversion_shape check (
    (currency = 'usd' and amount_usd is null and fx_rate is null and fx_rate_date is null)
    or (currency <> 'usd' and amount_usd is not null and fx_rate is not null and fx_rate_date is not null)
  );

alter table public.trucking_rates
  add constraint trucking_rates_currency_conversion_shape check (
    (currency = 'usd' and amount_usd is null and fx_rate is null and fx_rate_date is null)
    or (currency <> 'usd' and amount_usd is not null and fx_rate is not null and fx_rate_date is not null)
  );

alter table public.auction_fee_brackets
  add constraint auction_fee_brackets_currency_conversion_shape check (
    (currency = 'usd' and amount_usd is null and fx_rate is null and fx_rate_date is null)
    or (currency <> 'usd' and amount_usd is not null and fx_rate is not null and fx_rate_date is not null)
  );
