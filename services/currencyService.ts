const API_URL = 'https://open.er-api.com/v6/latest/USD';
const CACHE_KEY = 'autotrend_rates_cache';
const CACHE_DURATION = 1000 * 60 * 60 * 4; // 4 hours

interface RatesResponse {
  rates: Record<string, number>;
  time_last_update_unix: number;
}

// Fallback rates if API fails
const FALLBACK_RATES: Record<string, number> = {
  'USD': 1,
  'NGN': 1500,
  'EUR': 0.92,
  'GBP': 0.79
};

export const fetchExchangeRates = async (): Promise<Record<string, number>> => {
  try {
    // Check Cache
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { rates, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_DURATION) {
        return rates;
      }
    }

    // Fetch New
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error('Failed to fetch rates');
    
    const data: RatesResponse = await response.json();
    
    // Transform to our needs: The API returns 1 USD = X Currency.
    // Our app often needs to know "How many NGN is 1 USD" which is exactly what data.rates['NGN'] is.
    
    const rates = {
        'USD': 1,
        'NGN': data.rates['NGN'] || FALLBACK_RATES['NGN'],
        'EUR': data.rates['EUR'] || FALLBACK_RATES['EUR'],
        'GBP': data.rates['GBP'] || FALLBACK_RATES['GBP']
    };

    localStorage.setItem(CACHE_KEY, JSON.stringify({ rates, timestamp: Date.now() }));
    return rates;

  } catch (error) {
    console.warn("Currency fetch failed, using fallback:", error);
    return FALLBACK_RATES;
  }
};

/**
 * Converts any amount to USD based on provided rates.
 * @param amount Amount in source currency
 * @param currencyCode Source currency code (NGN, EUR, etc)
 * @param rates The rates object (1 USD = X Currency)
 */
export const convertToUSD = (amount: number, currencyCode: string, rates: Record<string, number>): number => {
    if (currencyCode === 'USD') return amount;
    const rate = rates[currencyCode];
    if (!rate) return amount; // Safety net
    return amount / rate;
};

/**
 * Converts USD to target currency
 */
export const convertFromUSD = (usdAmount: number, targetCurrency: string, rates: Record<string, number>): number => {
    if (targetCurrency === 'USD') return usdAmount;
    const rate = rates[targetCurrency];
    if (!rate) return usdAmount;
    return usdAmount * rate;
};