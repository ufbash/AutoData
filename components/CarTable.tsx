import React, { useState } from 'react';
import { CarSale, Currency, SortDirection, SortField } from '../types';
import { ArrowUpDown, ArrowUp, ArrowDown, Trash2, Tag, Filter, User, Pencil } from 'lucide-react';

interface CarTableProps {
  sales: CarSale[];
  onDelete: (id: string) => void;
  onEdit: (sale: CarSale) => void;
  displayCurrency: Currency;
  exchangeRates: Record<string, number>;
}

const CarTable: React.FC<CarTableProps> = ({ sales, onDelete, onEdit, displayCurrency, exchangeRates }) => {
  const [sortField, setSortField] = useState<SortField>('dateSold');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  
  // Filters
  const [filterDealer, setFilterDealer] = useState('');
  const [filterTag, setFilterTag] = useState('');

  const uniqueDealers = Array.from(new Set(sales.map(s => s.dealer))).filter(Boolean);
  const uniqueTags = Array.from(new Set(sales.flatMap(s => s.tags || [])));

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-[#a58039]/50" />;
    return sortDirection === 'asc' ? 
      <ArrowUp className="w-3 h-3 text-[#a58039]" /> : 
      <ArrowDown className="w-3 h-3 text-[#a58039]" />;
  };

  const convertPrice = (price: number, fromCurrency: string) => {
    if (fromCurrency === displayCurrency) return price;
    const priceInNGN = fromCurrency === 'NGN' ? price : price * (exchangeRates[fromCurrency] || 1);
    return displayCurrency === 'NGN' ? priceInNGN : priceInNGN / (exchangeRates[displayCurrency] || 1);
  };

  const filteredSales = sales.filter(sale => {
      const matchesDealer = filterDealer ? sale.dealer === filterDealer : true;
      const matchesTag = filterTag ? (sale.tags || []).includes(filterTag) : true;
      return matchesDealer && matchesTag;
  });

  const sortedSales = [...filteredSales].sort((a, b) => {
    const multiplier = sortDirection === 'asc' ? 1 : -1;
    switch (sortField) {
      case 'dateSold':
        const dateA = a.dateSold ? new Date(a.dateSold).getTime() : 0;
        const dateB = b.dateSold ? new Date(b.dateSold).getTime() : 0;
        return multiplier * (dateA - dateB);
      case 'price':
        const priceA = convertPrice(a.price, a.originalCurrency);
        const priceB = convertPrice(b.price, b.originalCurrency);
        return multiplier * (priceA - priceB);
      case 'daysToSell':
        const daysA = a.daysToSell !== undefined ? a.daysToSell : -1;
        const daysB = b.daysToSell !== undefined ? b.daysToSell : -1;
        return multiplier * (daysA - daysB);
      case 'make':
        return multiplier * a.make.localeCompare(b.make);
      default:
        return 0;
    }
  });

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-[#a58039]/20 flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2 text-[#403f4c]">
              <Filter className="w-4 h-4 text-[#a58039]" />
              <span className="text-sm font-bold uppercase tracking-wide">Filters:</span>
          </div>
          
          <div className="flex items-center gap-2">
             <User className="w-4 h-4 text-gray-400" />
             <select 
                value={filterDealer} 
                onChange={(e) => setFilterDealer(e.target.value)}
                className="text-sm border-gray-300 rounded-md focus:ring-[#a58039] focus:border-[#a58039] bg-[#F0EDDE] p-1 text-[#403f4c]"
             >
                 <option value="">All Dealers</option>
                 {uniqueDealers.map(d => <option key={d} value={d}>{d}</option>)}
             </select>
          </div>

          <div className="flex items-center gap-2">
             <Tag className="w-4 h-4 text-gray-400" />
             <select 
                value={filterTag} 
                onChange={(e) => setFilterTag(e.target.value)}
                className="text-sm border-gray-300 rounded-md focus:ring-[#a58039] focus:border-[#a58039] bg-[#F0EDDE] p-1 text-[#403f4c]"
             >
                 <option value="">All Tags</option>
                 {uniqueTags.map(t => <option key={t} value={t}>{t}</option>)}
             </select>
          </div>

          {(filterDealer || filterTag) && (
              <button 
                onClick={() => { setFilterDealer(''); setFilterTag(''); }}
                className="text-xs text-[#ba3b46] hover:text-red-700 underline ml-auto"
              >
                  Clear Filters
              </button>
          )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-[#a58039]/20 overflow-hidden">
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
            <thead className="bg-[#a58039]/10 text-[#403f4c] uppercase font-bold tracking-wider">
                <tr>
                <th onClick={() => handleSort('make')} className="px-6 py-3 cursor-pointer hover:bg-[#a58039]/20">
                    <div className="flex items-center gap-1">Vehicle {getSortIcon('make')}</div>
                </th>
                <th className="px-6 py-3">Details</th>
                <th onClick={() => handleSort('price')} className="px-6 py-3 cursor-pointer hover:bg-[#a58039]/20 text-right">
                    <div className="flex items-center justify-end gap-1">Sold For {getSortIcon('price')}</div>
                </th>
                <th onClick={() => handleSort('dateSold')} className="px-6 py-3 cursor-pointer hover:bg-[#a58039]/20">
                    <div className="flex items-center gap-1">Date {getSortIcon('dateSold')}</div>
                </th>
                <th onClick={() => handleSort('daysToSell')} className="px-6 py-3 cursor-pointer hover:bg-[#a58039]/20 text-center">
                    <div className="flex items-center justify-center gap-1">Days {getSortIcon('daysToSell')}</div>
                </th>
                <th className="px-6 py-3 text-right">Actions</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EDDE]">
                {sortedSales.length === 0 ? (
                    <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                            No records found matching your filters.
                        </td>
                    </tr>
                ) : (
                    sortedSales.map((sale) => (
                    <tr key={sale.id} className="hover:bg-[#F0EDDE]/50 transition-colors">
                        <td className="px-6 py-4">
                            <div className="font-medium text-[#403f4c]">{sale.year} {sale.make} {sale.model}</div>
                            <div className="text-xs text-[#a58039]">{sale.subModel !== 'Unknown' ? sale.subModel : ''}</div>
                        </td>
                        <td className="px-6 py-4">
                            <div className="flex flex-col gap-1">
                                {sale.dealer && (
                                    <span className="flex items-center gap-1 text-xs text-gray-600">
                                        <User className="w-3 h-3" /> {sale.dealer}
                                    </span>
                                )}
                                {sale.tags && sale.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                        {sale.tags.map(t => (
                                            <span key={t} className="text-[10px] bg-[#F0EDDE] text-[#403f4c] px-1.5 py-0.5 rounded-full border border-[#a58039]/20">
                                                {t}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-[#403f4c]">
                            {new Intl.NumberFormat('en-US', { style: 'decimal', maximumFractionDigits: 0 }).format(convertPrice(sale.price, sale.originalCurrency))}
                            <span className="text-xs text-gray-400 ml-1">{displayCurrency}</span>
                        </td>
                        <td className="px-6 py-4 text-gray-600">
                            {sale.dateSold || '-'}
                        </td>
                        <td className="px-6 py-4 text-center">
                            {sale.daysToSell !== undefined ? (
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                    sale.daysToSell < 14 ? 'bg-[#61988e]/20 text-[#61988e]' : 
                                    sale.daysToSell < 45 ? 'bg-yellow-100 text-yellow-800' : 'bg-[#ba3b46]/10 text-[#ba3b46]'
                                }`}>
                                    {sale.daysToSell}
                                </span>
                            ) : (
                                <span className="text-gray-400">-</span>
                            )}
                        </td>
                        <td className="px-6 py-4 text-right whitespace-nowrap">
                            <button 
                                onClick={() => onEdit(sale)}
                                className="text-gray-400 hover:text-[#403f4c] transition-colors mr-3"
                                title="Edit Sale"
                            >
                                <Pencil className="w-4 h-4" />
                            </button>
                            <button 
                                onClick={() => onDelete(sale.id)}
                                className="text-gray-400 hover:text-[#ba3b46] transition-colors"
                                title="Delete Sale"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </td>
                    </tr>
                    ))
                )}
            </tbody>
            </table>
        </div>
      </div>
    </div>
  );
};

export default CarTable;