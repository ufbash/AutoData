🏛️ AutoData Data Architecture & Logic Brief
1. Core Philosophy
AutoData has transitioned from a "prototype" structure (relying on string tags and assumed perfect data) to a resilient production architecture.

Explicit over Implicit: We use strict Enums (RecordType) instead of string tags to define data sources.

Safe Math: We officially support missing data (null prices) without corrupting analytics.

Data Confidence: We strictly separate "My Inventory" (Financials) from "Market Data" (Trends).

2. The Data Schema (Source of Truth)
The CarSale interface in src/types.ts is the strict contract for all data.

New Enum: RecordType

Replaces the old "External Data" tag.

INVENTORY: Verified internal sales. Counts towards Revenue and Performance.

MARKET_DATA: External intel (e.g., from other dealers). Excluded from Revenue, but useful for Market Volume analysis.

Nullable Fields

We no longer force fake numbers (like 0 or NaN) into the database.

price: number | null (Can be unknown).

priceUSD: number | null (Can be unknown).

daysToSell: number | null (Can be unknown if dates are missing/invalid).

mileage: number | null (Can be unknown).

3. Logic & Rules
Rule 1: The "Source of Truth" Toggle

User Action: Toggling "External Market Data Mode" in the form.

Old Logic: Added/Removed string "External Data" to tags.

New Logic: Switches recordType state between RecordType.INVENTORY and RecordType.MARKET_DATA.

Display: The UI must clearly badge MARKET_DATA records as "External" in tables.

Rule 2: Price Integrity (Handling Unknowns)

Scenario: A user logs a car but does not know the sold price.

Form: Price field is optional. Empty input saves as null.

Storage: price: null and priceUSD: null.

Conversion: convertToUSD is never called if price is null.

Rule 3: Date Validity & Velocity

Scenario: "Days to Sell" calculation.

Requirement: Both dateListed AND dateSold must be valid, non-empty ISO strings.

Calculation: Math.abs(sold - listed) in days.

Failure Mode: If either date is missing or invalid -> daysToSell = null.

Strictness: We never store NaN or 0 (unless it actually sold same-day).

Rule 4: Automatic Migration

Scenario: Loading an old database (JSON or LocalStorage) created before this update.

Trigger: Happens automatically inside storageService.ts -> getStoredSales().

Migration Logic:

Check each record.

If tags contains "External Data" -> Set recordType = MARKET_DATA.

Else -> Set recordType = INVENTORY.

Remove "External Data" string from tags (cleanup).

Validate price: If missing/invalid, force to null.

Rule 5: Mileage Integrity

Scenario: Mileage is often unknown for market data.

Storage: number | null.

Sorting: When sorting by "Low Mileage" (Best), unknown values must appear at the bottom of the list. They must never be treated as 0.

4. Analytics & "Safe Math" Protocols
The Dashboard (App.tsx) must adhere to these strict formulas to prevent data corruption.

A. Total Revenue

Formula: Sum of priceUSD (converted to display currency).

Filter: recordType === INVENTORY AND price !== null.

Why: External data and unpriced cars contribute $0 to your actual revenue.

B. Average Sale Price

Formula: Total Revenue / Count of Valid Priced Cars

Filter: recordType === INVENTORY AND price !== null.

CRITICAL: Do NOT divide by Total Cars. Dividing by cars with null prices would artificially lower the average.

C. Total Volume (Units)

Formula: Count of all records.

Filter: recordType === INVENTORY (for "My Sales") OR All (for "Market Activity").

Note: Unpriced cars DO count here.

D. Sales Velocity (Avg Days to Sell)

Formula: Average of daysToSell.

Filter: recordType === INVENTORY AND daysToSell !== null.

Why: We exclude external data (often bulk-uploaded with bad dates) to protect your personal performance metrics.

5. Technical Implementation Details
Files Modified

src/types.ts:

Added enum RecordType.

Updated CarSale interface with | null types.

src/services/storageService.ts:

Added migration logic to getStoredSales() to backfill recordType.

src/components/CarForm.tsx:

Repurposed "External Mode" toggle to control recordType.

Removed required attribute from Price input.

Added "Safe Math" check for daysToSell generation.

Added "Sticky Mode" preference for recordType (saved to localStorage).

Added Mileage input field (optional, stores as null if empty).

src/App.tsx:

Updated stats useMemo to implement the Safe Math Protocols (excluding nulls/external from averages).

src/components/CarTable.tsx:

Added visual handling for null prices (displays "N/A").

Updated "External" badge logic to check recordType.

Added Mileage column with sorting (nulls treated as Infinity).

src/services/storageService.ts:

Added mileage migration (backfills null for existing records).