-- AutoData: sales table with camelCase columns (quoted identifiers).
-- Must match storageService.ts / CarSale.

create table if not exists public.sales (
  id text primary key,
  make text not null,
  model text not null,
  "subModel" text not null,
  year text not null,
  price numeric,
  "originalCurrency" text not null,
  "priceUSD" numeric,
  "exchangeRate" numeric not null default 1,
  "dateListed" text,
  "dateSold" text,
  "daysToSell" integer,
  mileage integer,
  dealer text not null,
  tags jsonb not null default '[]'::jsonb,
  notes text,
  "recordType" text not null
);
