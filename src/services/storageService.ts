import { CarSale, RecordType, Currency } from "../types";
import { supabase } from "./supabaseClient";
import { convertToUSD } from "./currencyService";
import { v4 as uuidv4 } from "uuid";

export { supabase };

// NOTE: The `sales` table is officially DEPRECATED in Step 5b.
// It is retained physically in the database as a historical backup.
// All new writes and reads are routed to the `assets` and `sightings` ledger.

export interface AppIngestPayload {
  entry_method: 'manual_entry' | 'ai_vision';
  record_type: 'INVENTORY' | 'MARKET_DATA';
  org_id?: string;
  vehicles: Array<{
    vin?: string;
    make: string;
    model: string;
    trim?: string;
    year?: number;
    exterior_color?: string;
    mileage_miles?: number;
    dealer?: string;
    sale_price?: number | null;
    sale_date?: string;
    listed_price?: number | null;
    date_listed?: string;
    listed_currency?: string;
    // Additional fields we want to pack into raw_payload for backward compatibility
    tags?: string[];
    priceUSD?: number | null;
    exchangeRate?: number;
    daysToSell?: number | null;
    notes?: string;
  }>;
}

export const getStoredSales = async (): Promise<CarSale[]> => {
  const { data, error } = await supabase
    .from("sightings")
    .select("id, dealer_source, listed_price, listed_currency, sale_date, mileage_miles, raw_payload, logged_via, captured_at, assets ( make, model, trim, year )")
    .order("captured_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch sightings from Supabase:", error);
    throw error;
  }

  if (!data || !Array.isArray(data)) return [];

  return data.map((row: any): CarSale => {
    const raw = row.raw_payload || {};
    const asset = row.assets || {};
    return {
      id: row.id,
      make: asset.make || "Unknown",
      model: asset.model || "Unknown",
      trim: asset.trim || "Base",
      year: asset.year?.toString() || "Unknown",
      price: row.listed_price,
      originalCurrency: row.listed_currency || 'NGN',
      priceUSD: raw.priceUSD ?? null,
      exchangeRate: raw.exchangeRate ?? 1,
      dateListed: raw.dateListed || raw.date_listed,
      dateSold: row.sale_date || undefined,
      daysToSell: raw.daysToSell ?? null,
      mileage: row.mileage_miles,
      dealer: row.dealer_source || 'Unknown',
      tags: raw.tags || [],
      notes: raw.notes || undefined,
      recordType: raw.recordType || raw.record_type || RecordType.INVENTORY,
      logged_via: row.logged_via
    };
  });
};

export const ingestSales = async (payload: AppIngestPayload): Promise<CarSale[]> => {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session) {
    throw new Error("You must be logged in to save records.");
  }

  const token = sessionData.session.access_token;
  const projectUrl = import.meta.env.VITE_SUPABASE_URL;

  // We add saved dealer/make/model to local storage here as a convenience
  payload.vehicles.forEach(v => {
    if (v.dealer && v.dealer !== "Unknown") addSavedDealer(v.dealer);
    if (v.make && v.model) addVehicleData(v.make, v.model);
    if (v.trim && v.trim !== "Base" && v.trim !== "Unknown") addSavedTrim(v.trim);
  });

  const response = await fetch(`${projectUrl}/functions/v1/app-ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ingest failed: ${errText}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(`Ingest reported errors: ${JSON.stringify(result.errors)}`);
  }

  return getStoredSales();
};

export const deleteSale = async (id: string): Promise<CarSale[]> => {
  const { error } = await supabase.from("sightings").delete().eq("id", id);
  if (error) {
    console.error("deleteSale failed:", error);
    throw error;
  }
  return getStoredSales();
};

export const deleteSales = async (ids: string[]): Promise<CarSale[]> => {
  if (ids.length === 0) return getStoredSales();
  const { error } = await supabase.from("sightings").delete().in("id", ids);
  if (error) {
    console.error("deleteSales failed:", error);
    throw error;
  }
  return getStoredSales();
};

export const importSales = async (sales: CarSale[]): Promise<void> => {
  throw new Error("importSales is disabled for the unified ledger. Please use Bulk Import instead.");
};

export const mergeSales = async (sales: CarSale[]): Promise<CarSale[]> => {
  if (sales.length === 0) return getStoredSales();
  
  const payload: AppIngestPayload = {
    entry_method: 'manual_entry',
    record_type: 'INVENTORY',
    vehicles: sales.map(s => ({
      make: s.make,
      model: s.model,
      trim: s.trim,
      year: s.year !== 'Unknown' ? parseInt(s.year) : undefined,
      sale_price: s.price,
      listed_currency: s.originalCurrency,
      date_listed: s.dateListed,
      sale_date: s.dateSold,
      mileage_miles: s.mileage ?? undefined,
      dealer: s.dealer,
      tags: s.tags,
      daysToSell: s.daysToSell
    }))
  };

  return ingestSales(payload);
};

export const standardizeTrims = async (): Promise<Record<string, string>> => {
  // TODO: Repoint to operate on assets.trim / sightings
  console.warn("standardizeTrims is stubbed pending step 5b trim refactor.");
  return {};
};

export const executeTrimCleanup = async (dirtyName: string, cleanName: string): Promise<void> => {
  // TODO: Repoint to operate on assets.trim / sightings
  console.warn("executeTrimCleanup is stubbed pending step 5b trim refactor.");
};

// --- Auxiliary data remains in localStorage (dealers, vehicle DB, trims) ---

const DEALERS_KEY = "autotrend_saved_dealers";
const VEHICLE_DB_KEY = "autotrend_vehicle_db";
const TRIMS_KEY = "autotrend_saved_trims";

const INITIAL_VEHICLES: Record<string, string[]> = {
  Toyota: ["Camry", "Corolla", "Highlander", "RAV4", "Sienna", "Avalon", "Land Cruiser", "Prado", "Venza", "Yaris", "Tacoma", "Tundra", "4Runner", "Sequoia", "Hilux"],
  Lexus: ["RX 350", "ES 350", "GX 460", "LX 570", "IS 250", "NX 200t", "GS 350", "LS 460", "RC 350", "LX 600"],
  "Mercedes-Benz": ["C-Class", "E-Class", "GLK", "GLE", "GLS", "G-Class", "S-Class", "CLA", "GLA", "ML 350", "GL 450", "C300", "C43 AMG", "G63 AMG"],
  Honda: ["Accord", "Civic", "CR-V", "Pilot", "Crosstour", "Odyssey", "HR-V"],
  Ford: ["Edge", "Explorer", "Escape", "F-150", "Mustang", "Focus", "Fusion"],
  Hyundai: ["Elantra", "Sonata", "Tucson", "Santa Fe", "Accent", "Palisade"],
  Kia: ["Rio", "Optima", "Sportage", "Sorento", "Cerato", "Picanto"],
  "Land Rover": ["Range Rover", "Range Rover Sport", "Range Rover Evoque", "Discovery", "Defender", "Velar"],
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
      : ["LE", "XLE", "SE", "XSE", "Limited", "Platinum", "Sport", "Base", "AMG", "4Matic"];
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
