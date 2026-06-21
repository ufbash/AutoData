export interface CarSale {
  id: string;
  make: string;
  model: string;
  trim: string;
  year: string;
  price: number | null; // Original input price (nullable for market records / unknown)
  originalCurrency: string; // The currency selected during input
  priceUSD: number | null; // The calculated USD value (Source of Truth for value)
  exchangeRate: number; // The rate used at time of entry (Original -> USD)
  dateListed?: string;
  dateSold?: string;
  daysToSell: number | null; // Explicitly nullable; never undefined/NaN
  mileage: number | null; // Vehicle mileage (nullable if unknown)
  dealer: string;
  tags: string[];
  notes?: string;
  recordType: RecordType;
}

export enum RecordType {
  INVENTORY = 'INVENTORY',
  MARKET_DATA = 'MARKET_DATA',
}

export interface StandardizedCarData {
  make: string;
  model: string;
  trim: string;
  year: string;
  price?: number;
  currency?: string;
  dealer?: string;
  dateSold?: string;
}

export enum Currency {
  NGN = 'NGN',
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP'
}

export type SortField = 'dateSold' | 'price' | 'daysToSell' | 'make' | 'mileage';
export type SortDirection = 'asc' | 'desc';

export interface CarStats {
  totalSold: number;
  totalVolume: number;
  avgDaysToSell: number;
  fastestMoving: CarSale | null;
  topModels: { name: string; count: number; avgPrice: number }[];
  topDealers: { name: string; count: number; volume: number }[];
}

export interface MarketForecast {
  prediction: string;
  recommendedModels: string[];
  marketSentiment: 'bullish' | 'bearish' | 'neutral';
}