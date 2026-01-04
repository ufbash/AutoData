import React, { useState, useEffect, useMemo } from 'react';
import { Download, Plus, LayoutDashboard, List, Car } from 'lucide-react';
import { CarSale, Currency, CarStats } from './types';
import { getStoredSales, saveSale, deleteSale } from './services/storageService';
import CarForm from './components/CarForm';
import Dashboard from './components/Dashboard';
import CarTable from './components/CarTable';

// Mock Exchange Rates (Base NGN)
const EXCHANGE_RATES: Record<string, number> = {
  'NGN': 1,
  'USD': 1500, // 1 USD = 1500 NGN
  'EUR': 1650,
  'GBP': 1900
};

const App: React.FC = () => {
  const [sales, setSales] = useState<CarSale[]>([]);
  const [view, setView] = useState<'dashboard' | 'list'>('dashboard');
  const [showForm, setShowForm] = useState(false);
  const [editingSale, setEditingSale] = useState<CarSale | null>(null);
  const [displayCurrency, setDisplayCurrency] = useState<Currency>(Currency.NGN);

  useEffect(() => {
    setSales(getStoredSales());
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
      // Optional: scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelForm = () => {
      setShowForm(false);
      setEditingSale(null);
  };

  const handleDeleteSale = (id: string) => {
    if (window.confirm('Are you sure you want to permanently delete this sale record?')) {
      const updatedSales = deleteSale(id);
      setSales(updatedSales);
    }
  };

  const handleExport = () => {
    const headers = ['Make', 'Model', 'SubModel', 'Year', 'Price', 'Currency', 'Date Listed', 'Date Sold', 'Days to Sell', 'Dealer', 'Tags'];
    const csvContent = [
      headers.join(','),
      ...sales.map(s => [
        s.make,
        s.model,
        s.subModel,
        s.year,
        s.price,
        s.originalCurrency,
        s.dateListed || '',
        s.dateSold || '',
        s.daysToSell !== undefined ? s.daysToSell : '',
        s.dealer || 'Unknown',
        (s.tags || []).join(';') // Use ; as separator for tags
      ].map(field => `"${field}"`).join(',')) // Quote fields to handle commas in data
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `autotrend_export_${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
      // Convert to NGN for standardized volume stats
      const rate = EXCHANGE_RATES[sale.originalCurrency] || 1;
      const amountInNGN = sale.price * rate;

      totalVolumeNGN += amountInNGN;
      
      if (sale.daysToSell !== undefined) {
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
    const displayRate = EXCHANGE_RATES[displayCurrency] || 1;
    const totalVolumeDisplay = totalVolumeNGN / displayRate;

    const topModels = Object.entries(modelCounts)
      .map(([name, data]) => ({
        name,
        count: data.count,
        avgPrice: (data.totalNGN / data.count) / displayRate
      }))
      .sort((a, b) => b.count - a.count);

    const topDealers = Object.entries(dealerCounts)
      .map(([name, data]) => ({
        name,
        count: data.count,
        volume: data.totalNGN / displayRate
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
  }, [sales, displayCurrency]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <div className="bg-indigo-600 p-2 rounded-lg">
                <Car className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">
                AutoTrend Tracker
              </h1>
            </div>
            
            <div className="flex items-center gap-4">
              <select 
                value={displayCurrency} 
                onChange={(e) => setDisplayCurrency(e.target.value as Currency)}
                className="bg-gray-100 border-none text-sm font-medium rounded-lg py-2 pl-3 pr-8 focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                {Object.values(Currency).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              
              <button 
                onClick={handleExport}
                className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                title="Export to Excel/CSV"
              >
                <Download className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Actions Bar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div className="flex bg-white rounded-lg p-1 shadow-sm border border-gray-200">
            <button
              onClick={() => setView('dashboard')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                view === 'dashboard' 
                  ? 'bg-indigo-600 text-white shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              Overview
            </button>
            <button
              onClick={() => setView('list')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                view === 'list' 
                  ? 'bg-indigo-600 text-white shadow-sm' 
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
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
            className="flex items-center gap-2 bg-gray-900 text-white px-5 py-2.5 rounded-lg hover:bg-gray-800 transition-all shadow-lg shadow-gray-900/20 active:scale-95"
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
            />
          </div>
        )}

        {/* Views */}
        {view === 'dashboard' ? (
          <Dashboard stats={stats} currency={displayCurrency} exchangeRates={EXCHANGE_RATES} allSales={sales} />
        ) : (
          <CarTable 
            sales={sales} 
            onDelete={handleDeleteSale} 
            onEdit={handleEditSale}
            displayCurrency={displayCurrency}
            exchangeRates={EXCHANGE_RATES}
          />
        )}
      </main>
    </div>
  );
};

export default App;
