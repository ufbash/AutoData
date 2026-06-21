import { CarSale, RecordType, Currency } from "../types";
import { supabase } from "./supabaseClient";
import { convertToUSD } from "./currencyService";
import { v4 as uuidv4 } from "uuid";

export { supabase };

/**
 * Supabase table `sales` — PostgreSQL columns use camelCase (quoted identifiers),
 * matching PostgREST/JSON and the CarSale TypeScript shape.
 */

/** Row as returned by Supabase (camelCase keys). */
interface SalesRow {
  id: string;
  make: string;
  model: string;
  trim: string;
  year: string;
  price: number | null;
  originalCurrency: string;
  priceUSD: number | null;
  exchangeRate: number;
  dateListed: string | null;
  dateSold: string | null;
  daysToSell: number | null;
  mileage: number | null;
  dealer: string;
  tags: unknown;
  notes: string | null;
  recordType: string;
}

function rowToCarSale(row: SalesRow): CarSale {
  const tagsRaw = row.tags;
  const tagsArray: string[] = Array.isArray(tagsRaw)
    ? tagsRaw.filter((t): t is string => typeof t === "string")
    : [];

  const recordType =
    row.recordType === RecordType.MARKET_DATA
      ? RecordType.MARKET_DATA
      : RecordType.INVENTORY;

  const price =
    typeof row.price === "number" && Number.isFinite(row.price)
      ? row.price
      : null;
  const priceUSD =
    typeof row.priceUSD === "number" && Number.isFinite(row.priceUSD)
      ? row.priceUSD
      : null;
  const daysToSell =
    typeof row.daysToSell === "number" && Number.isFinite(row.daysToSell)
      ? row.daysToSell
      : null;
  const mileage =
    typeof row.mileage === "number" && Number.isFinite(row.mileage)
      ? row.mileage
      : null;

  return {
    id: row.id,
    make: row.make,
    model: row.model,
    trim: row.trim,
    year: row.year,
    price,
    originalCurrency: row.originalCurrency,
    priceUSD,
    exchangeRate:
      typeof row.exchangeRate === "number" && Number.isFinite(row.exchangeRate)
        ? row.exchangeRate
        : 1,
    dateListed: row.dateListed ?? undefined,
    dateSold: row.dateSold ?? undefined,
    daysToSell,
    mileage,
    dealer: row.dealer,
    tags: tagsArray,
    notes: row.notes ?? undefined,
    recordType,
  };
}

/** Payload for insert/upsert: camelCase only, nulls for optional DB columns. */
function carSaleToDbRow(s: CarSale): SalesRow {
  return {
    id: s.id,
    make: s.make,
    model: s.model,
    trim: s.trim,
    year: s.year,
    price: s.price,
    originalCurrency: s.originalCurrency,
    priceUSD: s.priceUSD,
    exchangeRate: s.exchangeRate,
    dateListed: s.dateListed ?? null,
    dateSold: s.dateSold ?? null,
    daysToSell: s.daysToSell ?? null,
    mileage: s.mileage ?? null,
    dealer: s.dealer,
    tags: s.tags,
    notes: s.notes ?? null,
    recordType: s.recordType,
  };
}

export const prepareCarPayload = (
  data: Partial<CarSale>,
  currentRates: Record<string, number>
): CarSale => {
  const originalCurrency = (data.originalCurrency as Currency) || Currency.NGN;
  const numericPrice = data.price ?? null;
  const usdValue =
    numericPrice === null
      ? null
      : convertToUSD(numericPrice, originalCurrency, currentRates);

  let daysToSell: number | null = null;
  if (data.dateListed && data.dateSold) {
    const listedMs = Date.parse(data.dateListed);
    const soldMs = Date.parse(data.dateSold);
    if (Number.isFinite(listedMs) && Number.isFinite(soldMs)) {
      const diffTime = Math.abs(soldMs - listedMs);
      daysToSell = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
  }

  return {
    id: data.id || uuidv4(),
    make: data.make || "Unknown",
    model: data.model || "Unknown",
    trim: data.trim || "Base",
    year: data.year || "Unknown",
    price: numericPrice,
    originalCurrency: originalCurrency,
    priceUSD: usdValue, // Stored Truth
    exchangeRate: currentRates[originalCurrency] || 1, // Store rate at time of entry
    dateListed: data.dateListed || undefined,
    dateSold: data.dateSold || new Date().toISOString().split("T")[0],
    daysToSell: daysToSell,
    mileage: data.mileage ?? null,
    dealer: data.dealer || "Unknown",
    tags: data.tags || [],
    recordType: data.recordType || RecordType.INVENTORY,
  };
};

export const getStoredSales = async (): Promise<CarSale[]> => {
  const { data, error } = await supabase
    .from("sales")
    .select("*")
    .order("dateSold", { ascending: false, nullsFirst: false });

  if (error) {
    console.error("Failed to fetch sales from Supabase:", error);
    throw error;
  }

  if (!data || !Array.isArray(data)) return [];

  return (data as SalesRow[]).map(rowToCarSale);
};

/** Upsert one or more rows by primary key `id`; returns the full table after fetch. */
export const saveSales = async (sales: CarSale[]): Promise<CarSale[]> => {
  if (sales.length === 0) return getStoredSales();

  const rows = sales.map(carSaleToDbRow);
  const { error } = await supabase.from("sales").upsert(rows, {
    onConflict: "id",
  });

  if (error) {
    console.error("saveSales failed:", error);
    throw error;
  }

  return getStoredSales();
};

export const saveSale = async (sale: CarSale): Promise<CarSale[]> => {
  return saveSales([sale]);
};

export const deleteSale = async (id: string): Promise<CarSale[]> => {
  const { error } = await supabase.from("sales").delete().eq("id", id);

  if (error) {
    console.error("deleteSale failed:", error);
    throw error;
  }

  return getStoredSales();
};

export const deleteSales = async (ids: string[]): Promise<CarSale[]> => {
  if (ids.length === 0) return getStoredSales();

  const { error } = await supabase.from("sales").delete().in("id", ids);

  if (error) {
    console.error("deleteSales failed:", error);
    throw error;
  }

  return getStoredSales();
};

/** Replace all rows in `sales` with the given array (full sync). */
export const importSales = async (sales: CarSale[]): Promise<void> => {
  const { data: existing, error: selectError } = await supabase
    .from("sales")
    .select("id");

  if (selectError) {
    console.error("importSales select failed:", selectError);
    throw selectError;
  }

  const ids = (existing ?? []).map((r: { id: string }) => r.id);
  if (ids.length > 0) {
    const { error: deleteError } = await supabase
      .from("sales")
      .delete()
      .in("id", ids);

    if (deleteError) {
      console.error("importSales delete failed:", deleteError);
      throw deleteError;
    }
  }

  if (sales.length === 0) return;

  const rows = sales.map(carSaleToDbRow);
  const { error: insertError } = await supabase.from("sales").insert(rows);

  if (insertError) {
    console.error("importSales insert failed:", insertError);
    throw insertError;
  }
};

export const mergeSales = async (newSales: CarSale[]): Promise<CarSale[]> => {
  await saveSales(newSales);
  newSales.forEach((s) => {
    if (s.dealer && s.dealer !== "Unknown") addSavedDealer(s.dealer);
    if (s.make && s.model) addVehicleData(s.make, s.model);
    if (s.trim && s.trim !== "Base" && s.trim !== "Unknown")
      addSavedTrim(s.trim);
  });
  return getStoredSales();
};

export const standardizeTrims = async (): Promise<Record<string, string>> => {
  const { data, error } = await supabase.from("sales").select("trim");
  if (error) {
    console.error("Failed to fetch trims:", error);
    return {};
  }

  const uniqueTrims = Array.from(new Set(data.map(row => row.trim).filter(Boolean)));
  const mapping: Record<string, string> = {};

  uniqueTrims.forEach(dirtyName => {
    let cleanName = dirtyName.trim();
    
    // Example standardization rules
    if (/^XSE\d*\s*plug$/i.test(cleanName) || /^XSE$/i.test(cleanName)) cleanName = "XSE";
    else if (/^AMG/i.test(cleanName)) cleanName = "AMG";
    else if (/^M-Sport/i.test(cleanName) || /^M Sport/i.test(cleanName)) cleanName = "M-Sport";
    else if (/^Autobiography/i.test(cleanName)) cleanName = "Autobiography";
    else if (/^Limited/i.test(cleanName)) cleanName = "Limited";
    
    if (cleanName !== dirtyName) {
      mapping[dirtyName] = cleanName;
    }
  });

  return mapping;
};

export const executeTrimCleanup = async (dirtyName: string, cleanName: string): Promise<void> => {
  const { error } = await supabase
    .from("sales")
    .update({ trim: cleanName })
    .eq("trim", dirtyName);

  if (error) {
    console.error(`Failed to merge ${dirtyName} to ${cleanName}:`, error);
    throw error;
  }
  
  // Clean up localStorage
  removeSavedTrim(dirtyName);
  addSavedTrim(cleanName);
};

// --- Auxiliary data remains in localStorage (dealers, vehicle DB, trims) ---

const DEALERS_KEY = "autotrend_saved_dealers";
const VEHICLE_DB_KEY = "autotrend_vehicle_db";
const TRIMS_KEY = "autotrend_saved_trims";

const INITIAL_VEHICLES: Record<string, string[]> = {
  Toyota: [
    "Camry",
    "Corolla",
    "Highlander",
    "RAV4",
    "Sienna",
    "Avalon",
    "Land Cruiser",
    "Prado",
    "Venza",
    "Yaris",
    "Tacoma",
    "Tundra",
    "4Runner",
    "Sequoia",
    "Hilux",
  ],
  Lexus: [
    "RX 350",
    "ES 350",
    "GX 460",
    "LX 570",
    "IS 250",
    "NX 200t",
    "GS 350",
    "LS 460",
    "RC 350",
    "LX 600",
  ],
  "Mercedes-Benz": [
    "C-Class",
    "E-Class",
    "GLK",
    "GLE",
    "GLS",
    "G-Class",
    "S-Class",
    "CLA",
    "GLA",
    "ML 350",
    "GL 450",
    "C300",
    "C43 AMG",
    "G63 AMG",
  ],
  Honda: ["Accord", "Civic", "CR-V", "Pilot", "Crosstour", "Odyssey", "HR-V"],
  Ford: ["Edge", "Explorer", "Escape", "F-150", "Mustang", "Focus", "Fusion"],
  Hyundai: ["Elantra", "Sonata", "Tucson", "Santa Fe", "Accent", "Palisade"],
  Kia: ["Rio", "Optima", "Sportage", "Sorento", "Cerato", "Picanto"],
  "Land Rover": [
    "Range Rover",
    "Range Rover Sport",
    "Range Rover Evoque",
    "Discovery",
    "Defender",
    "Velar",
  ],
  Nissan: ["Altima", "Maxima", "Rogue", "Pathfinder", "Versa", "Sentra"],
  Acura: ["MDX", "RDX", "TLX", "ZDX"],
  Volkswagen: ["Golf", "Jetta", "Passat", "Tiguan", "Touareg"],
  Mazda: ["CX-5", "CX-9", "Mazda3", "Mazda6"],
  BMW: ["3 Series", "5 Series", "7 Series", "X3", "X5", "X6", "X1"],
};

export const getSavedDealers = (): string[] => {
  try {
    const data = localStorage.getItem(DEALERS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
};

export const addSavedDealer = (name: string): string[] => {
  const current = new Set(getSavedDealers());
  current.add(name.trim());
  const updated = Array.from(current).sort();
  localStorage.setItem(DEALERS_KEY, JSON.stringify(updated));
  return updated;
};

export const removeSavedDealer = (name: string): string[] => {
  const current = getSavedDealers().filter((d) => d !== name);
  localStorage.setItem(DEALERS_KEY, JSON.stringify(current));
  return current;
};

export const getVehicleDB = (): Record<string, string[]> => {
  try {
    const data = localStorage.getItem(VEHICLE_DB_KEY);
    return data ? JSON.parse(data) : INITIAL_VEHICLES;
  } catch (e) {
    return INITIAL_VEHICLES;
  }
};

export const addVehicleData = (make: string, model: string): void => {
  const db = getVehicleDB();
  const cleanMake = make.trim();
  const cleanModel = model.trim();

  let makeKey = Object.keys(db).find(
    (k) => k.toLowerCase() === cleanMake.toLowerCase()
  );

  if (!makeKey) {
    makeKey = cleanMake;
    db[makeKey] = [cleanModel];
  } else {
    if (!db[makeKey].some((m) => m.toLowerCase() === cleanModel.toLowerCase())) {
      db[makeKey].push(cleanModel);
      db[makeKey].sort();
    }
  }

  localStorage.setItem(VEHICLE_DB_KEY, JSON.stringify(db));
};

export const removeMake = (make: string): void => {
  const db = getVehicleDB();
  delete db[make];
  localStorage.setItem(VEHICLE_DB_KEY, JSON.stringify(db));
};

export const removeModel = (make: string, model: string): void => {
  const db = getVehicleDB();
  if (db[make]) {
    db[make] = db[make].filter((m) => m !== model);
    localStorage.setItem(VEHICLE_DB_KEY, JSON.stringify(db));
  }
};

export const getSavedTrims = (): string[] => {
  try {
    const data = localStorage.getItem(TRIMS_KEY);
    return data
      ? JSON.parse(data)
      : [
          "LE",
          "XLE",
          "SE",
          "XSE",
          "Limited",
          "Platinum",
          "Sport",
          "Base",
          "AMG",
          "4Matic",
        ];
  } catch (e) {
    return [];
  }
};

export const addSavedTrim = (trim: string): void => {
  const current = new Set(getSavedTrims());
  current.add(trim.trim());
  const updated = Array.from(current).sort();
  localStorage.setItem(TRIMS_KEY, JSON.stringify(updated));
};

export const removeSavedTrim = (trim: string): void => {
  const current = getSavedTrims().filter((s) => s !== trim);
  localStorage.setItem(TRIMS_KEY, JSON.stringify(current));
};
