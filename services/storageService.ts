import { CarSale } from "../types";

const STORAGE_KEY = 'autotrend_sales_data';
const DEALERS_KEY = 'autotrend_saved_dealers';
const VEHICLE_DB_KEY = 'autotrend_vehicle_db';
const SUBMODELS_KEY = 'autotrend_saved_submodels';

const INITIAL_VEHICLES: Record<string, string[]> = {
  "Toyota": ["Camry", "Corolla", "Highlander", "RAV4", "Sienna", "Avalon", "Land Cruiser", "Prado", "Venza", "Yaris", "Tacoma", "Tundra", "4Runner", "Sequoia", "Hilux"],
  "Lexus": ["RX 350", "ES 350", "GX 460", "LX 570", "IS 250", "NX 200t", "GS 350", "LS 460", "RC 350", "LX 600"],
  "Mercedes-Benz": ["C-Class", "E-Class", "GLK", "GLE", "GLS", "G-Class", "S-Class", "CLA", "GLA", "ML 350", "GL 450", "C300", "C43 AMG", "G63 AMG"],
  "Honda": ["Accord", "Civic", "CR-V", "Pilot", "Crosstour", "Odyssey", "HR-V"],
  "Ford": ["Edge", "Explorer", "Escape", "F-150", "Mustang", "Focus", "Fusion"],
  "Hyundai": ["Elantra", "Sonata", "Tucson", "Santa Fe", "Accent", "Palisade"],
  "Kia": ["Rio", "Optima", "Sportage", "Sorento", "Cerato", "Picanto"],
  "Land Rover": ["Range Rover", "Range Rover Sport", "Range Rover Evoque", "Discovery", "Defender", "Velar"],
  "Nissan": ["Altima", "Maxima", "Rogue", "Pathfinder", "Versa", "Sentra"],
  "Acura": ["MDX", "RDX", "TLX", "ZDX"],
  "Volkswagen": ["Golf", "Jetta", "Passat", "Tiguan", "Touareg"],
  "Mazda": ["CX-5", "CX-9", "Mazda3", "Mazda6"],
  "BMW": ["3 Series", "5 Series", "7 Series", "X3", "X5", "X6", "X1"]
};

export const getStoredSales = (): CarSale[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error("Failed to load sales data", e);
    return [];
  }
};

export const saveSale = (sale: CarSale): CarSale[] => {
  const current = getStoredSales();
  const index = current.findIndex(s => s.id === sale.id);
  
  let updated;
  if (index >= 0) {
    // Update existing
    updated = [...current];
    updated[index] = sale;
  } else {
    // Create new
    updated = [sale, ...current];
  }
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
};

export const deleteSale = (id: string): CarSale[] => {
  const current = getStoredSales();
  const updated = current.filter(s => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
};

export const importSales = (sales: CarSale[]): void => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sales));
}

// --- Dealer Storage ---

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
  const current = getSavedDealers().filter(d => d !== name);
  localStorage.setItem(DEALERS_KEY, JSON.stringify(current));
  return current;
};

// --- Vehicle DB Storage (Make/Model) ---

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
  
  // Find matching make key case-insensitive
  let makeKey = Object.keys(db).find(k => k.toLowerCase() === cleanMake.toLowerCase());
  
  if (!makeKey) {
    // New Make
    makeKey = cleanMake; // Use input casing for new make
    db[makeKey] = [cleanModel];
  } else {
    // Existing Make
    if (!db[makeKey].some(m => m.toLowerCase() === cleanModel.toLowerCase())) {
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
        db[make] = db[make].filter(m => m !== model);
        localStorage.setItem(VEHICLE_DB_KEY, JSON.stringify(db));
    }
};

// --- Sub-Model Storage ---

export const getSavedSubModels = (): string[] => {
    try {
        const data = localStorage.getItem(SUBMODELS_KEY);
        return data ? JSON.parse(data) : ["LE", "XLE", "SE", "XSE", "Limited", "Platinum", "Sport", "Base", "AMG", "4Matic"];
    } catch (e) {
        return [];
    }
};

export const addSavedSubModel = (subModel: string): void => {
    const current = new Set(getSavedSubModels());
    current.add(subModel.trim());
    const updated = Array.from(current).sort();
    localStorage.setItem(SUBMODELS_KEY, JSON.stringify(updated));
};

export const removeSavedSubModel = (subModel: string): void => {
    const current = getSavedSubModels().filter(s => s !== subModel);
    localStorage.setItem(SUBMODELS_KEY, JSON.stringify(current));
};
