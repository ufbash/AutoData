export interface CarSale {
  id: string;
  make: string;
  model: string;
  subModel: string;
  year: string;
  price: number;
  originalCurrency: string;
  dateListed?: string;
  dateSold?: string;
  daysToSell?: number;
  dealer: string;
  tags: string[];
  notes?: string;
}

export interface StandardizedCarData {
  make: string;
  model: string;
  subModel: string;
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

export type SortField = 'dateSold' | 'price' | 'daysToSell' | 'make';
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
