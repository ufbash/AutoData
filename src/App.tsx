import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Download, Plus, LayoutDashboard, List, Car, Upload, X, Globe, Loader2 } from 'lucide-react';
import { CarSale, Currency, CarStats, RecordType } from './types';
import { getStoredSales, saveSales, deleteSale, deleteSales, mergeSales, importSales, standardizeTrims, executeTrimCleanup, supabase } from './services/storageService';
import { fetchExchangeRates, convertToUSD, convertFromUSD } from './services/currencyService';
import { normalizeHistoricalData } from './services/geminiService';
import CarForm from './components/CarForm';
import Dashboard from './components/Dashboard';
import CarTable from './components/CarTable';
import BulkImport from './components/BulkImport';
import { v4 as uuidv4 } from 'uuid';

/** Normalize one legacy JSON object into CarSale (supports camelCase or old snake_case keys). */
function normalizeLegacySaleRecord(
  raw: unknown,
  rates: Record<string, number>
): CarSale | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const str = (camel: string, snake?: string): string | undefined => {
    const v = snake !== undefined ? o[camel] ?? o[snake] : o[camel];
    return typeof v === 'string' ? v : undefined;
  };

  const numOrNull = (camel: string, snake?: string): number | null => {
    const v = snake !== undefined ? o[camel] ?? o[snake] : o[camel];
    if (v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const make = str('make');
  const model = str('model');
  if (!make || !model) return null;

  const id = str('id') ?? uuidv4();
  const tagsRaw = o.tags;
  const tags: string[] = Array.isArray(tagsRaw)
    ? tagsRaw.filter((t): t is string => typeof t === 'string')
    : [];

  let recordType: RecordType =
    o.recordType === RecordType.MARKET_DATA || o.recordType === 'MARKET_DATA'
      ? RecordType.MARKET_DATA
      : RecordType.INVENTORY;
  if (tags.includes('External Data')) {
    recordType = RecordType.MARKET_DATA;
  }
  const cleanedTags = tags.filter((t) => t !== 'External Data');

  let priceUSD = numOrNull('priceUSD', 'price_usd');
  const price = numOrNull('price');
  const originalCurrency = str('originalCurrency', 'original_currency') ?? 'NGN';
  let exchangeRate = numOrNull('exchangeRate', 'exchange_rate') ?? 1;

  if (priceUSD === null && price !== null) {
    priceUSD = convertToUSD(price, originalCurrency, rates);
    exchangeRate = rates[originalCurrency] || exchangeRate || 1;
  }

  const daysToSell = numOrNull('daysToSell', 'days_to_sell');

  return {
    id,
    make,
    model,
    trim: str('trim', 'sub_model') || str('subModel') || 'Base',
    year: str('year') ?? 'Unknown',
    price,
    originalCurrency,
    priceUSD,
    exchangeRate,
    dateListed: str('dateListed', 'date_listed'),
    dateSold: str('dateSold', 'date_sold'),
    daysToSell,
    mileage: numOrNull('mileage'),
    dealer: str('dealer') ?? 'Unknown',
    tags: cleanedTags,
    notes: str('notes'),
    recordType,
  };
}

function extractLegacySalesArray(parsedData: unknown): unknown[] {
  if (Array.isArray(parsedData)) {
    return parsedData;
  }

  if (parsedData !== null && typeof parsedData === 'object' && !Array.isArray(parsedData)) {
    const o = parsedData as Record<string, unknown>;
    const fromSales = o.sales;
    const fromData = o.data;
    const fromNested =
      Array.isArray(fromSales)
        ? fromSales
        : Array.isArray(fromData)
          ? fromData
          : Object.values(o).find((val) => Array.isArray(val));

    if (Array.isArray(fromNested)) {
      return fromNested;
    }
  }

  throw new Error('Could not find an array of sales in the JSON file.');
}

const App: React.FC = () => {
  const [sales, setSales] = useState<CarSale[]>([]);
  const [salesLoading, setSalesLoading] = useState(true);
  const [view, setView] = useState<'dashboard' | 'list'>('dashboard');
  const [showForm, setShowForm] = useState(false);
  const [editingSale, setEditingSale] = useState<CarSale | null>(null);
  const [displayCurrency, setDisplayCurrency] = useState<Currency>(Currency.NGN);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({'USD': 1});
  const [includeMarketData, setIncludeMarketData] = useState(false);

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportCurrency, setExportCurrency] = useState<Currency>(Currency.NGN);
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [cleanupMapping, setCleanupMapping] = useState<Record<string, string>>({});
  const [isCleaning, setIsCleaning] = useState(false);
  const [isDetoxing, setIsDetoxing] = useState(false);
  const [detoxProgress, setDetoxProgress] = useState({ current: 0, total: 0 });
  const [detoxStatusMsg, setDetoxStatusMsg] = useState('');

  // Global Filters
  const [filterMake, setFilterMake] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [filterYear, setFilterYear] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setSalesLoading(true);
      try {
        const rates = await fetchExchangeRates();
        if (cancelled) return;
        setExchangeRates(rates);

        const stored = await getStoredSales();
        if (cancelled) return;

        let needsSave = false;
        const migrated: CarSale[] = stored.map((s) => {
          const recordType =
            s.recordType ??
            ((s.tags || []).includes('External Data') ? RecordType.MARKET_DATA : RecordType.INVENTORY);

          const cleanedTags = (s.tags || []).filter((t) => t !== 'External Data');
          const hasTagCleanup = cleanedTags.length !== (s.tags || []).length;

          const canComputeUSD = s.priceUSD === null && s.price !== null;
          const computedUSD = canComputeUSD ? convertToUSD(s.price, s.originalCurrency, rates) : s.priceUSD;

          const exchangeRate = canComputeUSD
            ? rates[s.originalCurrency] || s.exchangeRate || 1
            : s.exchangeRate;

          const changed =
            recordType !== s.recordType ||
            hasTagCleanup ||
            computedUSD !== s.priceUSD ||
            exchangeRate !== s.exchangeRate;

          if (changed) needsSave = true;

          return {
            ...s,
            recordType,
            tags: cleanedTags,
            priceUSD: computedUSD,
            exchangeRate,
            daysToSell: Number.isFinite(s.daysToSell as number) ? s.daysToSell : null,
          };
        });

        if (needsSave) {
          await importSales(migrated);
          if (cancelled) return;
          setSales(await getStoredSales());
        } else {
          setSales(migrated);
        }
      } catch (e) {
        console.error('Failed to load sales', e);
        alert('Could not load data from Supabase. Check VITE_SUPABASE_URL, your network, and table `sales`.');
      } finally {
        if (!cancelled) setSalesLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAddSale = async (newSales: CarSale[]) => {
    try {
      const updatedSales = await saveSales(newSales);
      setSales(updatedSales);
      setShowForm(false);
      setEditingSale(null);
    } catch (e) {
      console.error(e);
      alert('Failed to save to Supabase. Check your connection and credentials.');
    }
  };

  const handleEditSale = (sale: CarSale) => {
    setEditingSale(sale);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setEditingSale(null);
  };

  const handleDeleteSale = async (id: string) => {
    try {
      const updatedSales = await deleteSale(id);
      setSales(updatedSales);
    } catch (e) {
      console.error(e);
      alert('Failed to delete record in Supabase.');
    }
  };

  const handleBulkDelete = async (ids: string[]) => {
    try {
      const updatedSales = await deleteSales(ids);
      setSales(updatedSales);
    } catch (e) {
      console.error(e);
      alert('Failed to delete records in Supabase.');
    }
  };

  const triggerExport = () => {
    const headers = ['Make', 'Model', 'Trim', 'Year', 'Price', 'Currency', 'Date Listed', 'Date Sold', 'Days to Sell', 'Mileage', 'Dealer', 'Tags'];
    const csvContent = [
      headers.join(','),
      ...sales.map(s => {
        let exportPrice: number | null = s.price;
        if (exportCurrency === Currency.USD) {
            exportPrice =
              s.priceUSD !== null
                ? s.priceUSD
                : s.price !== null
                  ? convertToUSD(s.price, s.originalCurrency, exchangeRates)
                  : null;
        } else if (exportCurrency !== s.originalCurrency) {
            if (s.priceUSD !== null) {
                exportPrice = convertFromUSD(s.priceUSD, exportCurrency, exchangeRates);
            } else {
                exportPrice = null;
            }
        }
        return [
          s.make,
          s.model,
          s.trim,
          s.year,
          exportPrice === null ? 'N/A' : exportPrice.toFixed(2),
          exportCurrency,
          s.dateListed || '', s.dateSold || '', s.daysToSell !== null ? s.daysToSell : '',
          s.mileage !== null ? s.mileage : '',
          s.dealer || 'Unknown', (s.tags || []).join(';')
        ].map(field => `"${field}"`).join(',');
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `autodata_export_${exportCurrency}_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setShowExportModal(false);
  };

  const handleImportClick = () => {
      if (fileInputRef.current) {
          fileInputRef.current.value = '';
          fileInputRef.current.click();
      }
  };

  const handleOpenCleanup = async () => {
    try {
      const mapping = await standardizeTrims();
      setCleanupMapping(mapping);
      setShowCleanupModal(true);
    } catch (e) {
      alert("Failed to analyze trims for cleanup.");
    }
  };

  const handleDataDetox = async () => {
    const confirmDetox = window.confirm("This will use AI to analyze and clean up your entire historical database (Make, Model, Year, Trim, Dealer). This process may take a few minutes. Proceed?");
    if (!confirmDetox) return;

    setIsDetoxing(true);
    try {
      // 1. Fetch all sales
      const allSales = await getStoredSales();
      if (allSales.length === 0) {
        alert("No sales to clean.");
        setIsDetoxing(false);
        return;
      }

      // 2. Batch process (30 at a time)
      const batchSize = 30;
      const totalBatches = Math.ceil(allSales.length / batchSize);
      let totalCleaned = 0;
      
      setDetoxProgress({ current: 0, total: totalBatches });

      for (let i = 0; i < allSales.length; i += batchSize) {
        const currentBatchNum = Math.floor(i / batchSize) + 1;
        setDetoxProgress({ current: currentBatchNum, total: totalBatches });
        setDetoxStatusMsg(`Processing ${currentBatchNum}/${totalBatches}...`);
        
        const batch = allSales.slice(i, i + batchSize);
        console.log(`Sending batch ${currentBatchNum} to Gemini:`, batch);
        
        let success = false;
        let retries = 0;
        const maxRetries = 5;

        while (!success && retries < maxRetries) {
          try {
            const cleanedBatch = await normalizeHistoricalData(batch);
            console.log(`Received clean batch ${currentBatchNum} from Gemini:`, cleanedBatch);
            
            // 4. Update Supabase for each record
            for (const cleanRecord of cleanedBatch) {
               if (!cleanRecord.id) {
                   console.warn("Skipping record missing ID:", cleanRecord);
                   continue;
               }
               
               const { error } = await supabase
                 .from('sales')
                 .update({
                   make: cleanRecord.make,
                   model: cleanRecord.model,
                   trim: cleanRecord.trim,
                   year: cleanRecord.year,
                   dealer: cleanRecord.dealer
                 })
                 .eq('id', cleanRecord.id);
                 
               if (error) {
                 console.error(`Failed to update record ${cleanRecord.id}:`, error);
               } else {
                 totalCleaned++;
               }
            }
            
            success = true;
            setDetoxStatusMsg(`Processing ${currentBatchNum}/${totalBatches}...`);
            // Standard delay between successful batches to respect rate limits
            if (i + batchSize < allSales.length) {
              await new Promise(resolve => setTimeout(resolve, 10000)); // 10-second delay
            }
          } catch (batchError: any) {
             retries++;
             console.warn(`Error processing batch ${currentBatchNum} (Attempt ${retries}/${maxRetries}):`, batchError);
             if (batchError?.status === 429 || String(batchError).includes('429')) {
                console.warn(`Rate limit hit on batch ${currentBatchNum}. Waiting 65 seconds before retry...`);
                setDetoxStatusMsg(`Rate limit hit. Pausing for 60 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 65000));
             } else {
                // If it's not a rate limit, wait 5 seconds before retrying just in case
                await new Promise(resolve => setTimeout(resolve, 5000));
             }
             if (retries >= maxRetries) {
               console.error(`Failed to process batch ${currentBatchNum} after ${maxRetries} attempts. Skipping.`);
               break; // Move to the next batch
             }
          }
        }
      }

      // 5. Refresh
      alert(`Data Detox complete! Successfully cleaned ${totalCleaned} records.`);
      setSales(await getStoredSales());
    } catch (e) {
      console.error("Detox failed:", e);
      alert("A critical error occurred during the Data Detox process.");
    } finally {
      setIsDetoxing(false);
      setDetoxProgress({ current: 0, total: 0 });
      setDetoxStatusMsg('');
    }
  };

  const handleExecuteCleanup = async () => {
    setIsCleaning(true);
    try {
      for (const [dirty, clean] of Object.entries(cleanupMapping)) {
        await executeTrimCleanup(dirty, String(clean));
      }
      alert("Database cleanup successful!");
      setShowCleanupModal(false);
      // Reload sales to reflect the new clean names
      const updated = await getStoredSales();
      setSales(updated);
    } catch (e) {
      alert("An error occurred during cleanup.");
    } finally {
      setIsCleaning(false);
    }
  };

  const handleLegacyJsonImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      void (async () => {
        try {
          const text = e.target?.result as string;
          const parsedData: unknown = JSON.parse(text);
          const dataArray = extractLegacySalesArray(parsedData);

          const normalized: CarSale[] = [];
          const seenIds = new Set<string>();
          for (const item of dataArray) {
            const rec = normalizeLegacySaleRecord(item, exchangeRates);
            if (rec && !seenIds.has(rec.id)) {
              seenIds.add(rec.id);
              normalized.push(rec);
            }
          }

          if (normalized.length === 0) {
            alert('No valid sales records found in file.');
            return;
          }

          await mergeSales(normalized);
          setSales(await getStoredSales());
          alert('Migration complete! Refreshing dashboard.');
        } catch (error: any) {
          console.error('Full migration error:', error);
          alert('Migration failed: ' + (error?.message || JSON.stringify(error)));
        }
      })();
    };
    reader.readAsText(file);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
          const content = e.target?.result as string;
          if (content) {
              void (async () => {
              try {
                  const lines = content.split('\n');
                  const newSales: CarSale[] = [];
                  for (let i = 1; i < lines.length; i++) {
                      const line = lines[i].trim();
                      if (!line) continue;
                      if (line.startsWith('"') && line.endsWith('"')) {
                          const rawValues = line.substring(1, line.length - 1).split('","');
                          if (rawValues.length >= 6) {
                             const parsedPrice = Number(rawValues[4]);
                             const importedPrice = Number.isFinite(parsedPrice) ? parsedPrice : null;
                             const importedCurrency = rawValues[5] as Currency;
                             const usdValue =
                               importedPrice === null ? null : convertToUSD(importedPrice, importedCurrency, exchangeRates);
                             const parsedMileage = rawValues[9] ? Number(rawValues[9]) : null;
                             const importedMileage = parsedMileage !== null && Number.isFinite(parsedMileage) ? parsedMileage : null;
                             const rawTags = rawValues[11] ? rawValues[11].split(';') : [];
                             const hadLegacyExternal = rawTags.includes('External Data');
                             const cleanedTags = rawTags.filter(t => t !== 'External Data');
                             const sale: CarSale = {
                                 id: uuidv4(),
                                 make: rawValues[0], model: rawValues[1], trim: rawValues[2], year: rawValues[3],
                                 price: importedPrice, originalCurrency: importedCurrency, priceUSD: usdValue,
                                 exchangeRate: exchangeRates[importedCurrency] || 1, dateListed: rawValues[6],
                                 dateSold: rawValues[7],
                                 daysToSell: rawValues[8] && Number.isFinite(Number(rawValues[8])) ? Number(rawValues[8]) : null,
                                 mileage: importedMileage,
                                 dealer: rawValues[10] || 'Unknown',
                                 tags: cleanedTags,
                                 recordType: hadLegacyExternal ? RecordType.MARKET_DATA : RecordType.INVENTORY
                             };
                             newSales.push(sale);
                          }
                      }
                  }
                  if (newSales.length > 0) {
                      const updated = await mergeSales(newSales);
                      setSales(updated);
                      alert(`Successfully imported ${newSales.length} records.`);
                  } else {
                      alert("No valid records found.");
                  }
              } catch (error) {
                  console.error(error);
                  alert("Failed to parse or save imported file.");
              }
              })();
          }
      };
      reader.readAsText(file);
  };

  const globalFilteredSales = useMemo(() => {
    return sales.filter(s => {
      const matchMake = filterMake ? s.make === filterMake : true;
      const matchModel = filterModel ? s.model === filterModel : true;
      const matchYear = filterYear ? s.year === filterYear : true;
      return matchMake && matchModel && matchYear;
    });
  }, [sales, filterMake, filterModel, filterYear]);

  const stats: CarStats = useMemo(() => {
    if (globalFilteredSales.length === 0) {
      return { totalSold: 0, totalVolume: 0, avgDaysToSell: 0, fastestMoving: null, topModels: [], topDealers: [] };
    }
    let totalRevenueNGN = 0;
    let totalDays = 0;
    let countDays = 0;
    let fastest: CarSale | null = null;
    const modelCounts: Record<string, { count: number; totalNGN: number }> = {};
    const dealerCounts: Record<string, { count: number; totalNGN: number }> = {};

    globalFilteredSales.forEach(sale => {
      const isInventory = sale.recordType === RecordType.INVENTORY;
      const priceUSD =
        sale.priceUSD !== null
          ? sale.priceUSD
          : sale.price !== null
            ? convertToUSD(sale.price, sale.originalCurrency, exchangeRates)
            : null;
      const amountInNGN = priceUSD === null ? null : convertFromUSD(priceUSD, 'NGN', exchangeRates);

      if ((includeMarketData || isInventory) && sale.price !== null && amountInNGN !== null) {
        totalRevenueNGN += amountInNGN;
      }

      if ((includeMarketData || isInventory) && sale.daysToSell !== null) {
        totalDays += sale.daysToSell;
        countDays++;
        if (!fastest || fastest.daysToSell === null || sale.daysToSell < fastest.daysToSell) {
          fastest = sale;
        }
      }

      const modelKey = `${sale.make} ${sale.model}`;
      if (!modelCounts[modelKey]) modelCounts[modelKey] = { count: 0, totalNGN: 0 };
      modelCounts[modelKey].count++;
      if (amountInNGN !== null) modelCounts[modelKey].totalNGN += amountInNGN;

      const dealerKey = sale.dealer || 'Unknown';
      if (!dealerCounts[dealerKey]) dealerCounts[dealerKey] = { count: 0, totalNGN: 0 };
      dealerCounts[dealerKey].count++;
      if (amountInNGN !== null) dealerCounts[dealerKey].totalNGN += amountInNGN;
    });

    const totalVolumeDisplay =
      displayCurrency === 'NGN'
        ? totalRevenueNGN
        : convertToUSD(totalRevenueNGN, 'NGN', exchangeRates);
    const topModels = Object.entries(modelCounts)
      .map(([name, data]) => ({
        name,
        count: data.count,
        avgPrice: displayCurrency === 'NGN' ? data.totalNGN / data.count : convertToUSD(data.totalNGN / data.count, 'NGN', exchangeRates)
      })).sort((a, b) => b.count - a.count);

    const topDealers = Object.entries(dealerCounts)
      .map(([name, data]) => ({
        name,
        count: data.count,
        volume: displayCurrency === 'NGN' ? data.totalNGN : convertToUSD(data.totalNGN, 'NGN', exchangeRates)
      })).sort((a, b) => b.count - a.count);

    const totalSoldCount = includeMarketData
      ? sales.length
      : sales.filter(s => s.recordType === RecordType.INVENTORY).length;

    return { totalSold: totalSoldCount, totalVolume: totalVolumeDisplay, avgDaysToSell: countDays > 0 ? totalDays / countDays : 0, fastestMoving: fastest, topModels, topDealers };
  }, [sales, displayCurrency, exchangeRates, includeMarketData]);

  return (
    <div className="min-h-screen bg-[#F0EDDE] text-[#403f4c] font-sans relative">

      {showExportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-bold text-[#403f4c]">Export Data</h3>
                      <button onClick={() => setShowExportModal(false)} className="text-gray-400 hover:text-[#ba3b46]">
                          <X className="w-5 h-5" />
                      </button>
                  </div>
                  <p className="text-sm text-gray-500 mb-4">Select currency for export.</p>
                  <div className="space-y-3 mb-6">
                      <button onClick={() => setExportCurrency(Currency.NGN)} className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${exportCurrency === Currency.NGN ? 'border-[#a58039] bg-[#a58039]/10 text-[#a58039]' : 'border-gray-200 hover:bg-gray-50'}`}>
                          <span className="font-bold">Nigerian Naira (NGN)</span>
                          {exportCurrency === Currency.NGN && <div className="w-3 h-3 rounded-full bg-[#a58039]" />}
                      </button>
                      <button onClick={() => setExportCurrency(Currency.USD)} className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${exportCurrency === Currency.USD ? 'border-[#a58039] bg-[#a58039]/10 text-[#a58039]' : 'border-gray-200 hover:bg-gray-50'}`}>
                          <span className="font-bold">US Dollar (USD)</span>
                          {exportCurrency === Currency.USD && <div className="w-3 h-3 rounded-full bg-[#a58039]" />}
                      </button>
                  </div>
                  <button onClick={triggerExport} className="w-full py-3 bg-[#403f4c] text-white rounded-lg font-bold hover:bg-[#2d2c35] transition-colors flex items-center justify-center gap-2">
                      <Download className="w-4 h-4" /> Download CSV
                  </button>
              </div>
          </div>
      )}

      {showCleanupModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 max-h-[80vh] flex flex-col">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-bold text-[#403f4c]">Database Cleanup</h3>
                      <button onClick={() => setShowCleanupModal(false)} className="text-gray-400 hover:text-[#ba3b46]">
                          <X className="w-5 h-5" />
                      </button>
                  </div>
                  <p className="text-sm text-gray-500 mb-4">
                    The following trims will be standardized to clean up duplicates:
                  </p>
                  
                  <div className="flex-1 overflow-y-auto mb-6 border border-gray-200 rounded-lg bg-gray-50 p-2">
                    {Object.keys(cleanupMapping).length === 0 ? (
                      <p className="text-sm text-center text-gray-500 p-4">No cleanup needed! All trims look good.</p>
                    ) : (
                      <table className="w-full text-sm text-left">
                        <thead className="text-xs text-gray-500 uppercase border-b border-gray-200">
                          <tr>
                            <th className="px-3 py-2">Current Name</th>
                            <th className="px-3 py-2 w-8"></th>
                            <th className="px-3 py-2">New Name</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(cleanupMapping).map(([dirty, clean]) => (
                            <tr key={dirty} className="border-b border-gray-100 last:border-0">
                              <td className="px-3 py-2 text-red-600 line-through">{dirty}</td>
                              <td className="px-3 py-2 text-gray-400 text-center">→</td>
                              <td className="px-3 py-2 text-green-600 font-medium">{String(clean)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <button 
                      onClick={() => setShowCleanupModal(false)} 
                      className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-lg font-bold hover:bg-gray-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handleExecuteCleanup} 
                      disabled={isCleaning || Object.keys(cleanupMapping).length === 0}
                      className="flex-1 py-3 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isCleaning ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      {isCleaning ? 'Cleaning...' : 'Confirm & Clean'}
                    </button>
                  </div>
              </div>
          </div>
      )}

      <header className="bg-white/80 backdrop-blur-sm border-b border-[#a58039]/20 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="bg-[#a58039] p-2 rounded-lg shadow-sm">
                <Car className="w-6 h-6 text-[#F0EDDE]" />
              </div>
              <div className="flex flex-col">
                <h1 className="text-2xl font-bold text-[#a58039] leading-none tracking-tight">AutoData</h1>
                <span className="text-[10px] font-semibold text-[#403f4c] tracking-[0.2em] uppercase mt-0.5">by caplimo</span>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <select
                value={displayCurrency}
                onChange={(e) => setDisplayCurrency(e.target.value as Currency)}
                className="bg-[#F0EDDE] border-none text-sm font-medium rounded-lg py-2 pl-3 pr-8 focus:ring-2 focus:ring-[#a58039] cursor-pointer text-[#403f4c]"
              >
                {Object.values(Currency).map(c => <option key={c} value={c}>{c}</option>)}
              </select>

              <button
                onClick={() => setIncludeMarketData(!includeMarketData)}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${
                  includeMarketData
                    ? 'bg-[#61988e] text-white'
                    : 'bg-[#F0EDDE] text-[#403f4c] hover:bg-[#e0ddce]'
                }`}
                title={includeMarketData ? 'Showing all data (inventory + market)' : 'Showing inventory only'}
              >
                <Globe className="w-3 h-3" />
                {includeMarketData ? 'All Data' : 'My Inventory'}
              </button>

              <div className="flex items-center bg-[#F0EDDE] rounded-lg p-1">
                <button onClick={handleImportClick} className="p-1.5 text-[#403f4c]/70 hover:text-[#a58039] hover:bg-white rounded-md transition-all shadow-sm" title="Import from CSV">
                  <Upload className="w-5 h-5" />
                </button>
                <div className="w-px h-5 bg-[#a58039]/20 mx-1"></div>
                <button onClick={() => setShowExportModal(true)} className="p-1.5 text-[#403f4c]/70 hover:text-[#a58039] hover:bg-white rounded-md transition-all shadow-sm" title="Export to CSV">
                  <Download className="w-5 h-5" />
                </button>
              </div>

              <input
                type="file"
                accept=".json,application/json"
                id="legacy-json-upload"
                className="hidden"
                onChange={handleLegacyJsonImport}
              />

              <input type="file" accept=".csv" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {salesLoading && (
          <div className="mb-6 rounded-lg border border-[#a58039]/30 bg-white/90 px-4 py-3 text-sm text-[#403f4c]">
            Loading sales from Supabase…
          </div>
        )}

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div className="flex bg-white rounded-lg p-1 shadow-sm border border-[#a58039]/20">
            <button onClick={() => setView('dashboard')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${view === 'dashboard' ? 'bg-[#a58039] text-[#F0EDDE] shadow-sm' : 'text-[#403f4c] hover:text-[#a58039] hover:bg-[#F0EDDE]'}`}>
              <LayoutDashboard className="w-4 h-4" /> Overview
            </button>
            <button onClick={() => setView('list')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${view === 'list' ? 'bg-[#a58039] text-[#F0EDDE] shadow-sm' : 'text-[#403f4c] hover:text-[#a58039] hover:bg-[#F0EDDE]'}`}>
              <List className="w-4 h-4" /> All Records
            </button>
            <button onClick={() => setView('bulk-import')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${view === 'bulk-import' ? 'bg-[#a58039] text-[#F0EDDE] shadow-sm' : 'text-[#403f4c] hover:text-[#a58039] hover:bg-[#F0EDDE]'}`}>
              <Upload className="w-4 h-4" /> Bulk Import
            </button>
          </div>
          <button onClick={() => { setShowForm(!showForm); setEditingSale(null); }} className="flex items-center gap-2 bg-[#403f4c] text-[#F0EDDE] px-5 py-2.5 rounded-lg hover:bg-[#403f4c]/90 transition-all shadow-lg shadow-[#403f4c]/20 active:scale-95 border border-[#403f4c]">
            <Plus className="w-5 h-5" /> {showForm && !editingSale ? 'Cancel Entry' : 'Add Sold Car'}
          </button>
        </div>

        {showForm && (
          <div className="mb-8">
            <CarForm initialData={editingSale} onSaleAdded={handleAddSale} onCancel={handleCancelForm} currentRates={exchangeRates} />
          </div>
        )}

        {!salesLoading && view === 'dashboard' && (
          <Dashboard stats={stats} currency={displayCurrency} exchangeRates={exchangeRates} allSales={sales} includeMarketData={includeMarketData} />
        )}
        {!salesLoading && view === 'list' && (
          <CarTable sales={sales} onDelete={handleDeleteSale} onBulkDelete={handleBulkDelete} onEdit={handleEditSale} displayCurrency={displayCurrency} exchangeRates={exchangeRates} includeMarketData={includeMarketData} />
        )}
        {!salesLoading && view === 'bulk-import' && (
          <BulkImport 
            onSave={async (newSales) => {
              try {
                const updatedSales = await mergeSales(newSales);
                setSales(updatedSales);
                setView('list');
              } catch (e) {
                console.error(e);
                throw e;
              }
            }} 
            currentRates={exchangeRates} 
          />
        )}
      </main>
    </div>
  );
};

export default App;