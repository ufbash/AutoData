import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Download, Plus, LayoutDashboard, List, Car, Upload, DollarSign, X } from 'lucide-react';
import { CarSale, Currency, CarStats } from './types';
import { getStoredSales, saveSale, deleteSale, deleteSales, mergeSales, importSales } from './services/storageService';
import { fetchExchangeRates, convertToUSD, convertFromUSD } from './services/currencyService';
import CarForm from './components/CarForm';
import Dashboard from './components/Dashboard';
import CarTable from './components/CarTable';
import { v4 as uuidv4 } from 'uuid';

const App: React.FC = () => {
  const [sales, setSales] = useState<CarSale[]>([]);
  const [view, setView] = useState<'dashboard' | 'list'>('dashboard');
  const [showForm, setShowForm] = useState(false);
  const [editingSale, setEditingSale] = useState<CarSale | null>(null);
  const [displayCurrency, setDisplayCurrency] = useState<Currency>(Currency.NGN);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({'USD': 1});
  
  // Export Modal State
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportCurrency, setExportCurrency] = useState<Currency>(Currency.NGN);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 1. Fetch Rates
    const initRates = async () => {
        const rates = await fetchExchangeRates();
        setExchangeRates(rates);
        return rates;
    };

    // 2. Load Sales & Migrate if needed
    initRates().then((rates) => {
        const stored = getStoredSales();
        let needsSave = false;
        
        // Migration: If old data lacks priceUSD, add it using current rates (best effort)
        const migrated = stored.map(s => {
            if (s.priceUSD === undefined) {
                needsSave = true;
                return {
                    ...s,
                    priceUSD: convertToUSD(s.price, s.originalCurrency, rates),
                    exchangeRate: rates[s.originalCurrency] || 1
                };
            }
            return s;
        });

        if (needsSave) {
            importSales(migrated); // Save back to local storage
        }
        setSales(migrated);
    });
  }, []);

  const handleAddSale = (newSale: CarSale) => {
    const updatedSales = saveSale(newSale);
    setSales(updatedSales);
    setShowForm(false);
    setEditingSale(null);
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

  const handleDeleteSale = (id: string) => {
    const updatedSales = deleteSale(id);
    setSales(updatedSales);
  };

  const handleBulkDelete = (ids: string[]) => {
      const updatedSales = deleteSales(ids);
      setSales(updatedSales);
  };

  // --- Export Logic ---
  const triggerExport = () => {
    const headers = ['Make', 'Model', 'SubModel', 'Year', 'Price', 'Currency', 'Date Listed', 'Date Sold', 'Days to Sell', 'Dealer', 'Tags'];
    
    const csvContent = [
      headers.join(','),
      ...sales.map(s => {
        // Decide what price to export based on user selection in modal
        let exportPrice = s.price;
        if (exportCurrency === Currency.USD) {
            exportPrice = s.priceUSD || convertToUSD(s.price, s.originalCurrency, exchangeRates);
        } else if (exportCurrency !== s.originalCurrency) {
            // If user wants NGN but item was USD, convert USD -> NGN
            if (s.priceUSD) {
                exportPrice = convertFromUSD(s.priceUSD, exportCurrency, exchangeRates);
            }
        }

        return [
          s.make,
          s.model,
          s.subModel,
          s.year,
          exportPrice.toFixed(2),
          exportCurrency, // Column says currency chosen
          s.dateListed || '',
          s.dateSold || '',
          s.daysToSell !== undefined ? s.daysToSell : '',
          s.dealer || 'Unknown',
          (s.tags || []).join(';')
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

  // --- Import Logic ---
  const handleImportClick = () => {
      if (fileInputRef.current) {
          fileInputRef.current.value = ''; 
          fileInputRef.current.click();
      }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
          const content = e.target?.result as string;
          if (content) {
              try {
                  const lines = content.split('\n');
                  const newSales: CarSale[] = [];
                  
                  for (let i = 1; i < lines.length; i++) {
                      const line = lines[i].trim();
                      if (!line) continue;
                      
                      if (line.startsWith('"') && line.endsWith('"')) {
                          const rawValues = line.substring(1, line.length - 1).split('","');
                          
                          if (rawValues.length >= 6) {
                             const importedPrice = Number(rawValues[4]);
                             const importedCurrency = rawValues[5] as Currency;
                             
                             // Calculate USD value using CURRENT rates for incoming data
                             const usdValue = convertToUSD(importedPrice, importedCurrency, exchangeRates);

                             const sale: CarSale = {
                                 id: uuidv4(),
                                 make: rawValues[0],
                                 model: rawValues[1],
                                 subModel: rawValues[2],
                                 year: rawValues[3],
                                 price: importedPrice,
                                 originalCurrency: importedCurrency,
                                 priceUSD: usdValue,
                                 exchangeRate: exchangeRates[importedCurrency] || 1,
                                 dateListed: rawValues[6],
                                 dateSold: rawValues[7],
                                 daysToSell: rawValues[8] ? Number(rawValues[8]) : undefined,
                                 dealer: rawValues[9],
                                 tags: rawValues[10] ? rawValues[10].split(';') : []
                             };
                             newSales.push(sale);
                          }
                      }
                  }

                  if (newSales.length > 0) {
                      const updated = mergeSales(newSales);
                      setSales(updated);
                      alert(`Successfully imported ${newSales.length} records.`);
                  } else {
                      alert("No valid records found in the CSV file.");
                  }

              } catch (error) {
                  console.error(error);
                  alert("Failed to parse CSV file. Ensure it matches the export format.");
              }
          }
      };
      reader.readAsText(file);
  };


  // Compute Stats
  const stats: CarStats = useMemo(() => {
    if (sales.length === 0) {
      return { totalSold: 0, totalVolume: 0, avgDaysToSell: 0, fastestMoving: null, topModels: [], topDealers: [] };
    }

    let totalVolumeNGN = 0;
    let totalDays = 0;
    let countDays = 0;
    let fastest: CarSale | null = null;
    const modelCounts: Record<string, { count: number; totalNGN: number }> = {};
    const dealerCounts: Record<string, { count: number; totalNGN: number }> = {};

    sales.forEach(sale => {
      const isExternalData = (sale.tags || []).includes('External Data');

      // Use priceUSD as base for all calculations, then convert to NGN for standardized internal summing
      const priceUSD = sale.priceUSD || convertToUSD(sale.price, sale.originalCurrency, exchangeRates);
      const amountInNGN = convertFromUSD(priceUSD, 'NGN', exchangeRates);

      totalVolumeNGN += amountInNGN;
      
      if (!isExternalData && sale.daysToSell !== undefined) {
          totalDays += sale.daysToSell;
          countDays++;

          if (!fastest || sale.daysToSell < fastest.daysToSell) {
            fastest = sale;
          }
      }

      // Model Stats
      const modelKey = `${sale.make} ${sale.model}`;
      if (!modelCounts[modelKey]) {
        modelCounts[modelKey] = { count: 0, totalNGN: 0 };
      }
      modelCounts[modelKey].count++;
      modelCounts[modelKey].totalNGN += amountInNGN;

      // Dealer Stats
      const dealerKey = sale.dealer || 'Unknown';
      if (!dealerCounts[dealerKey]) {
        dealerCounts[dealerKey] = { count: 0, totalNGN: 0 };
      }
      dealerCounts[dealerKey].count++;
      dealerCounts[dealerKey].totalNGN += amountInNGN;
    });

    // Convert total volume back to display currency for the dashboard card
    // Note: totalVolumeNGN is in NGN. If displayCurrency is USD, convert NGN -> USD
    const totalVolumeDisplay = displayCurrency === 'NGN' 
        ? totalVolumeNGN 
        : convertToUSD(totalVolumeNGN, 'NGN', exchangeRates);

    const topModels = Object.entries(modelCounts)
      .map(([name, data]) => ({
        name,
        count: data.count,
        avgPrice: displayCurrency === 'NGN' 
            ? data.totalNGN / data.count 
            : convertToUSD(data.totalNGN / data.count, 'NGN', exchangeRates)
      }))
      .sort((a, b) => b.count - a.count);

    const topDealers = Object.entries(dealerCounts)
      .map(([name, data]) => ({
        name,
        count: data.count,
        volume: displayCurrency === 'NGN' 
            ? data.totalNGN 
            : convertToUSD(data.totalNGN, 'NGN', exchangeRates)
      }))
      .sort((a, b) => b.count - a.count);

    return {
      totalSold: sales.length,
      totalVolume: totalVolumeDisplay,
      avgDaysToSell: countDays > 0 ? totalDays / countDays : 0,
      fastestMoving: fastest,
      topModels,
      topDealers
    };
  }, [sales, displayCurrency, exchangeRates]);

  return (
    <div className="min-h-screen bg-[#F0EDDE] text-[#403f4c] font-sans relative">
      
      {/* Export Currency Modal */}
      {showExportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-bold text-[#403f4c]">Export Data</h3>
                      <button onClick={() => setShowExportModal(false)} className="text-gray-400 hover:text-[#ba3b46]">
                          <X className="w-5 h-5" />
                      </button>
                  </div>
                  <p className="text-sm text-gray-500 mb-4">
                      Select the currency for the price column in the exported CSV file.
                  </p>
                  
                  <div className="space-y-3 mb-6">
                      <button 
                          onClick={() => setExportCurrency(Currency.NGN)}
                          className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${
                              exportCurrency === Currency.NGN 
                              ? 'border-[#a58039] bg-[#a58039]/10 text-[#a58039]' 
                              : 'border-gray-200 hover:bg-gray-50'
                          }`}
                      >
                          <span className="font-bold">Nigerian Naira (NGN)</span>
                          {exportCurrency === Currency.NGN && <div className="w-3 h-3 rounded-full bg-[#a58039]" />}
                      </button>
                      <button 
                          onClick={() => setExportCurrency(Currency.USD)}
                          className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${
                              exportCurrency === Currency.USD 
                              ? 'border-[#a58039] bg-[#a58039]/10 text-[#a58039]' 
                              : 'border-gray-200 hover:bg-gray-50'
                          }`}
                      >
                          <span className="font-bold">US Dollar (USD)</span>
                          {exportCurrency === Currency.USD && <div className="w-3 h-3 rounded-full bg-[#a58039]" />}
                      </button>
                  </div>

                  <button 
                      onClick={triggerExport}
                      className="w-full py-3 bg-[#403f4c] text-white rounded-lg font-bold hover:bg-[#2d2c35] transition-colors flex items-center justify-center gap-2"
                  >
                      <Download className="w-4 h-4" />
                      Download CSV
                  </button>
              </div>
          </div>
      )}

      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-[#a58039]/20 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="bg-[#a58039] p-2 rounded-lg shadow-sm">
                <Car className="w-6 h-6 text-[#F0EDDE]" />
              </div>
              <div className="flex flex-col">
                <h1 className="text-2xl font-bold text-[#a58039] leading-none tracking-tight">
                  AutoData
                </h1>
                <span className="text-[10px] font-semibold text-[#403f4c] tracking-[0.2em] uppercase mt-0.5">
                  by caplimo
                </span>
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
              
              <div className="flex items-center bg-[#F0EDDE] rounded-lg p-1">
                  <button 
                    onClick={handleImportClick}
                    className="p-1.5 text-[#403f4c]/70 hover:text-[#a58039] hover:bg-white rounded-md transition-all shadow-sm"
                    title="Import from CSV"
                  >
                    <Upload className="w-5 h-5" />
                  </button>
                  <div className="w-px h-5 bg-[#a58039]/20 mx-1"></div>
                  <button 
                    onClick={() => setShowExportModal(true)}
                    className="p-1.5 text-[#403f4c]/70 hover:text-[#a58039] hover:bg-white rounded-md transition-all shadow-sm"
                    title="Export to Excel/CSV"
                  >
                    <Download className="w-5 h-5" />
                  </button>
              </div>
              
              <input 
                 type="file" 
                 accept=".csv" 
                 ref={fileInputRef} 
                 className="hidden" 
                 onChange={handleFileChange}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Actions Bar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div className="flex bg-white rounded-lg p-1 shadow-sm border border-[#a58039]/20">
            <button
              onClick={() => setView('dashboard')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                view === 'dashboard' 
                  ? 'bg-[#a58039] text-[#F0EDDE] shadow-sm' 
                  : 'text-[#403f4c] hover:text-[#a58039] hover:bg-[#F0EDDE]'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              Overview
            </button>
            <button
              onClick={() => setView('list')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                view === 'list' 
                  ? 'bg-[#a58039] text-[#F0EDDE] shadow-sm' 
                  : 'text-[#403f4c] hover:text-[#a58039] hover:bg-[#F0EDDE]'
              }`}
            >
              <List className="w-4 h-4" />
              All Records
            </button>
          </div>

          <button
            onClick={() => {
                setShowForm(!showForm);
                setEditingSale(null);
            }}
            className="flex items-center gap-2 bg-[#403f4c] text-[#F0EDDE] px-5 py-2.5 rounded-lg hover:bg-[#403f4c]/90 transition-all shadow-lg shadow-[#403f4c]/20 active:scale-95 border border-[#403f4c]"
          >
            <Plus className="w-5 h-5" />
            {showForm && !editingSale ? 'Cancel Entry' : 'Add Sold Car'}
          </button>
        </div>

        {/* Input Form Area */}
        {showForm && (
          <div className="mb-8">
            <CarForm 
                initialData={editingSale}
                onSaleAdded={handleAddSale} 
                onCancel={handleCancelForm}
                currentRates={exchangeRates} 
            />
          </div>
        )}

        {/* Views */}
        {view === 'dashboard' ? (
          <Dashboard stats={stats} currency={displayCurrency} exchangeRates={exchangeRates} allSales={sales} />
        ) : (
          <CarTable 
            sales={sales} 
            onDelete={handleDeleteSale} 
            onBulkDelete={handleBulkDelete}
            onEdit={handleEditSale}
            displayCurrency={displayCurrency}
            exchangeRates={exchangeRates}
          />
        )}
      </main>
    </div>
  );
};

export default App;