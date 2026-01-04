import React, { useState, useMemo } from 'react';
import { 
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, Cell 
} from 'recharts';
import { CarStats, Currency, CarSale, MarketForecast } from '../types';
import { TrendingUp, Clock, DollarSign, Award, Brain, Briefcase } from 'lucide-react';
import { generateMarketForecast } from '../services/geminiService';

interface DashboardProps {
  stats: CarStats;
  currency: Currency;
  exchangeRates: Record<string, number>;
  allSales: CarSale[];
}

type TimeFrame = 'weekly' | 'monthly' | 'yearly';

const Dashboard: React.FC<DashboardProps> = ({ stats, currency, exchangeRates, allSales }) => {
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('monthly');
  const [forecast, setForecast] = useState<MarketForecast | null>(null);
  const [loadingForecast, setLoadingForecast] = useState(false);

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: currency,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const convertPrice = (price: number, fromCurrency: string) => {
    if (fromCurrency === currency) return price;
    const priceInNGN = fromCurrency === 'NGN' ? price : price * (exchangeRates[fromCurrency] || 1);
    return currency === 'NGN' ? priceInNGN : priceInNGN / (exchangeRates[currency] || 1);
  };

  // --- Aggregate Data for Charts ---
  const timeSeriesData = useMemo(() => {
    const data: Record<string, { name: string; sales: number; revenue: number; order: number }> = {};
    
    allSales.forEach(sale => {
      // Use dateSold if available, otherwise skip time series or put in 'Unknown' bucket?
      // For visual simplicity, we skip items without dateSold in time charts
      if (!sale.dateSold) return;

      const date = new Date(sale.dateSold);
      let key = '';
      let label = '';
      let order = 0;

      if (timeFrame === 'weekly') {
        const start = new Date(date.getFullYear(), 0, 1);
        const days = Math.floor((date.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
        const week = Math.ceil((date.getDay() + 1 + days) / 7);
        key = `${date.getFullYear()}-W${week}`;
        label = `W${week} ${date.getFullYear()}`;
        order = date.getTime();
      } else if (timeFrame === 'monthly') {
        key = `${date.getFullYear()}-${date.getMonth()}`;
        label = date.toLocaleString('default', { month: 'short', year: '2-digit' });
        order = date.getFullYear() * 100 + date.getMonth();
      } else {
        key = `${date.getFullYear()}`;
        label = `${date.getFullYear()}`;
        order = date.getFullYear();
      }

      if (!data[key]) {
        data[key] = { name: label, sales: 0, revenue: 0, order };
      }
      data[key].sales += 1;
      data[key].revenue += convertPrice(sale.price, sale.originalCurrency);
    });

    return Object.values(data).sort((a, b) => a.order - b.order);
  }, [allSales, timeFrame, currency, exchangeRates]);

  const dealerData = stats.topDealers.slice(0, 5).map(d => ({
      name: d.name,
      Sales: d.count
  }));

  const modelData = stats.topModels.slice(0, 5).map(item => ({
      name: item.name,
      Sales: item.count,
      Price: item.avgPrice
  }));

  // --- Forecast Logic ---
  const handleGenerateForecast = async () => {
    setLoadingForecast(true);
    try {
        const summary = stats.topModels.map(m => {
            const modelSales = allSales.filter(s => `${s.make} ${s.model}` === m.name && s.daysToSell !== undefined);
            const totalDays = modelSales.reduce((acc, curr) => acc + (curr.daysToSell || 0), 0);
            const avgDays = modelSales.length ? Math.round(totalDays / modelSales.length) : 0;

            return {
                model: m.name,
                avgPrice: m.avgPrice,
                unitsSold: m.count,
                avgDaysToSell: avgDays
            };
        });

        const result = await generateMarketForecast(summary);
        setForecast(result);
    } catch (e) {
        alert("Could not generate forecast. Check API Key.");
    } finally {
        setLoadingForecast(false);
    }
  };

  // New Palette: Gunmetal #403f4c, Gold #a58039, Seagrass #61988e, Cherry #ba3b46
  const COLORS = ['#a58039', '#403f4c', '#61988e', '#ba3b46', '#8c6d30'];

  return (
    <div className="space-y-6">
      
      {/* Top Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-[#a58039]/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Total Units Sold</p>
              <p className="text-2xl font-bold text-[#403f4c] mt-1">{stats.totalSold}</p>
            </div>
            <div className="bg-blue-100 p-3 rounded-full">
              <TrendingUp className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-[#a58039]/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Avg. Days to Sell</p>
              <p className="text-2xl font-bold text-[#403f4c] mt-1">{stats.avgDaysToSell.toFixed(1)} <span className="text-sm text-gray-400 font-normal">days</span></p>
            </div>
            <div className="bg-orange-100 p-3 rounded-full">
              <Clock className="w-6 h-6 text-orange-600" />
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-[#a58039]/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Total Volume</p>
              <p className="text-2xl font-bold text-[#403f4c] mt-1">{formatMoney(stats.totalVolume)}</p>
            </div>
            <div className="bg-green-100 p-3 rounded-full">
              <DollarSign className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-[#a58039]/20">
            <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Fastest Mover</p>
              <p className="text-sm font-bold text-[#403f4c] mt-1 truncate max-w-[120px]" title={stats.fastestMoving ? `${stats.fastestMoving.make} ${stats.fastestMoving.model}` : 'N/A'}>
                  {stats.fastestMoving ? `${stats.fastestMoving.make} ${stats.fastestMoving.model}` : 'N/A'}
              </p>
              <p className="text-xs text-[#61988e]">
                  {stats.fastestMoving && stats.fastestMoving.daysToSell !== undefined ? `${stats.fastestMoving.daysToSell} days` : '-'}
              </p>
            </div>
            <div className="bg-purple-100 p-3 rounded-full">
              <Award className="w-6 h-6 text-purple-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Main Charts Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Sales Over Time (Span 2 cols) */}
          <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-[#a58039]/20">
            <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold text-[#403f4c]">Sales Trends</h3>
                <div className="flex bg-[#F0EDDE] rounded-lg p-1">
                    {(['weekly', 'monthly', 'yearly'] as TimeFrame[]).map(t => (
                        <button
                            key={t}
                            onClick={() => setTimeFrame(t)}
                            className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition-colors ${
                                timeFrame === t ? 'bg-white shadow text-[#a58039]' : 'text-[#403f4c] hover:text-[#a58039]'
                            }`}
                        >
                            {t}
                        </button>
                    ))}
                </div>
            </div>
            <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timeSeriesData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#a58039" stopOpacity={0.1}/>
                                <stop offset="95%" stopColor="#a58039" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                        <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E5E5" />
                        <Tooltip 
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                            formatter={(value: any, name: string) => [
                                name === 'revenue' ? formatMoney(value) : value, 
                                name === 'revenue' ? 'Revenue' : 'Units Sold'
                            ]}
                        />
                        <Area type="monotone" dataKey="sales" stroke="#a58039" fillOpacity={1} fill="url(#colorSales)" strokeWidth={2} />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
          </div>

          {/* AI Prediction Card */}
          <div className="bg-[#403f4c] p-6 rounded-xl shadow-lg text-[#F0EDDE] relative overflow-hidden">
             <div className="absolute top-0 right-0 p-3 opacity-10">
                 <Brain className="w-32 h-32" />
             </div>
             <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                 <Brain className="w-5 h-5" />
                 AI Demand Forecast
             </h3>
             
             {!forecast && !loadingForecast && (
                 <div className="h-64 flex flex-col items-center justify-center text-center">
                     <p className="text-[#F0EDDE]/80 mb-4 text-sm">
                         Analyze historical sales data to predict next quarter's demand.
                     </p>
                     <button 
                        onClick={handleGenerateForecast}
                        className="bg-[#a58039] text-white px-4 py-2 rounded-lg font-medium hover:bg-[#8c6d30] transition-colors"
                     >
                         Generate Forecast
                     </button>
                 </div>
             )}

             {loadingForecast && (
                 <div className="h-64 flex flex-col items-center justify-center">
                     <Loader2 className="w-8 h-8 animate-spin text-[#F0EDDE] mb-2" />
                     <p className="text-[#F0EDDE]/80 text-sm">Analyzing market trends...</p>
                 </div>
             )}

             {forecast && (
                 <div className="space-y-4 animate-in fade-in">
                     <div>
                         <p className="text-xs uppercase text-[#F0EDDE]/60 font-bold mb-1">Sentiment</p>
                         <span className={`inline-block px-2 py-1 rounded text-xs font-bold uppercase ${
                             forecast.marketSentiment === 'bullish' ? 'bg-[#61988e]/30 text-[#61988e]' :
                             forecast.marketSentiment === 'bearish' ? 'bg-[#ba3b46]/30 text-[#ba3b46]' :
                             'bg-yellow-500/20 text-yellow-200'
                         }`}>
                             {forecast.marketSentiment}
                         </span>
                     </div>
                     <div>
                         <p className="text-xs uppercase text-[#F0EDDE]/60 font-bold mb-1">Recommendation</p>
                         <p className="text-sm leading-relaxed text-[#F0EDDE]">
                             {forecast.prediction}
                         </p>
                     </div>
                     <div>
                         <p className="text-xs uppercase text-[#F0EDDE]/60 font-bold mb-2">Acquire Now</p>
                         <div className="flex flex-wrap gap-2">
                             {forecast.recommendedModels.map(m => (
                                 <span key={m} className="bg-white/10 px-2 py-1 rounded text-xs border border-white/20">
                                     {m}
                                 </span>
                             ))}
                         </div>
                     </div>
                 </div>
             )}
          </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top Models Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-[#a58039]/20">
            <h3 className="text-lg font-bold text-[#403f4c] mb-6">Top Selling Models</h3>
            <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={modelData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E5E5" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 11}} />
                <Tooltip />
                <Bar dataKey="Sales" fill="#8884d8" radius={[0, 4, 4, 0]}>
                    {modelData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                </Bar>
                </BarChart>
            </ResponsiveContainer>
            </div>
        </div>

        {/* Top Dealers Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-[#a58039]/20">
            <div className="flex items-center gap-2 mb-6">
                <Briefcase className="w-5 h-5 text-gray-500" />
                <h3 className="text-lg font-bold text-[#403f4c]">Top Performing Dealers</h3>
            </div>
            <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dealerData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E5E5" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 11}} />
                <YAxis axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="Sales" fill="#61988e" radius={[4, 4, 0, 0]} />
                </BarChart>
            </ResponsiveContainer>
            </div>
        </div>
      </div>
    </div>
  );
};

// Simple loader component needed for dashboard internal state
const Loader2 = ({ className }: { className?: string }) => (
    <svg 
        xmlns="http://www.w3.org/2000/svg" 
        width="24" height="24" viewBox="0 0 24 24" 
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" 
        className={className}
    >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
);

export default Dashboard;