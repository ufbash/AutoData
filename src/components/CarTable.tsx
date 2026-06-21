import React, { useState, useEffect } from 'react';
import { CarSale, Currency, RecordType, SortDirection, SortField } from '../types';
import { ArrowUpDown, ArrowUp, ArrowDown, Trash2, Tag, Filter, User, Pencil, AlertCircle, CheckSquare, Square } from 'lucide-react';
import { convertFromUSD } from '../services/currencyService';

interface CarTableProps {
  sales: CarSale[];
  onDelete: (id: string) => void | Promise<void>;
  onBulkDelete?: (ids: string[]) => void | Promise<void>;
  onEdit: (sale: CarSale) => void;
  displayCurrency: Currency;
  exchangeRates: Record<string, number>;
}

const CarTable: React.FC<CarTableProps> = ({ sales, onDelete, onBulkDelete, onEdit, displayCurrency, exchangeRates }) => {
  const [sortField, setSortField] = useState<SortField>('dateSold');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  
  // Filters
  const [filterDealer, setFilterDealer] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterYear, setFilterYear] = useState('');

  // Delete Modal State
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [saleToDelete, setSaleToDelete] = useState<string | null>(null);
  const [isBulkDelete, setIsBulkDelete] = useState(false);

  // Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const uniqueDealers = Array.from(new Set(sales.map(s => s.dealer))).filter(Boolean);
  const uniqueTags = Array.from(new Set(sales.flatMap(s => s.tags || [])));
  const uniqueYears = Array.from(new Set(sales.map(s => s.year))).filter(y => y && y !== 'Unknown').sort().reverse();

  // Clear selections when filters change
  useEffect(() => {
      setSelectedIds(new Set());
  }, [filterDealer, filterTag, filterYear]);

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

  const getDisplayPrice = (sale: CarSale) => {
      // Use stored USD value as truth, convert to display currency using current rates
      if (sale.priceUSD !== null) {
          return convertFromUSD(sale.priceUSD, displayCurrency, exchangeRates);
      }
      // Fallback: if we only have original price and it's already in display currency, show it; otherwise N/A
      if (sale.price !== null && sale.originalCurrency === displayCurrency) return sale.price;
      return null;
  };

  const filteredSales = sales.filter(sale => {
      const matchesDealer = filterDealer ? sale.dealer === filterDealer : true;
      const matchesTag = filterTag ? (sale.tags || []).includes(filterTag) : true;
      const matchesYear = filterYear ? sale.year === filterYear : true;
      return matchesDealer && matchesTag && matchesYear;
  });

  const sortedSales = [...filteredSales].sort((a, b) => {
    const multiplier = sortDirection === 'asc' ? 1 : -1;
    switch (sortField) {
      case 'dateSold':
        const dateA = a.dateSold ? new Date(a.dateSold).getTime() : 0;
        const dateB = b.dateSold ? new Date(b.dateSold).getTime() : 0;
        return multiplier * (dateA - dateB);
      case 'price':
        const priceA = getDisplayPrice(a);
        const priceB = getDisplayPrice(b);
        if (priceA === null && priceB === null) return 0;
        if (priceA === null) return 1; // nulls last
        if (priceB === null) return -1;
        return multiplier * (priceA - priceB);
      case 'daysToSell':
        const daysA = a.daysToSell !== null ? a.daysToSell : -1;
        const daysB = b.daysToSell !== null ? b.daysToSell : -1;
        return multiplier * (daysA - daysB);
      case 'mileage':
        // Treat null as Infinity (push to bottom when sorting ascending)
        const mileageA = a.mileage !== null ? a.mileage : Infinity;
        const mileageB = b.mileage !== null ? b.mileage : Infinity;
        return multiplier * (mileageA - mileageB);
      case 'make':
        return multiplier * a.make.localeCompare(b.make);
      case 'year':
        const yearA = a.year === 'Unknown' ? 0 : parseInt(a.year, 10);
        const yearB = b.year === 'Unknown' ? 0 : parseInt(b.year, 10);
        return multiplier * (yearA - yearB);
      default:
        return 0;
    }
  });

  // Modal handlers
  const openDeleteModal = (id: string) => {
      setSaleToDelete(id);
      setIsBulkDelete(false);
      setDeleteModalOpen(true);
  };

  const openBulkDeleteModal = () => {
      setIsBulkDelete(true);
      setDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
      setDeleteModalOpen(false);
      setSaleToDelete(null);
      setIsBulkDelete(false);
  };

  const confirmDelete = () => {
      if (isBulkDelete && onBulkDelete) {
          onBulkDelete(Array.from(selectedIds));
          setSelectedIds(new Set());
      } else if (saleToDelete) {
          onDelete(saleToDelete);
      }
      closeDeleteModal();
  };

  // Selection Handlers
  const toggleSelectAll = () => {
      if (selectedIds.size === sortedSales.length && sortedSales.length > 0) {
          setSelectedIds(new Set());
      } else {
          setSelectedIds(new Set(sortedSales.map(s => s.id)));
      }
  };

  const toggleSelectRow = (id: string) => {
      const newSelection = new Set(selectedIds);
      if (newSelection.has(id)) {
          newSelection.delete(id);
      } else {
          newSelection.add(id);
      }
      setSelectedIds(newSelection);
  };

  return (
    <div className="space-y-4 relative">
      {/* Confirmation Modal */}
      {deleteModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6 transform transition-all scale-100 animate-in zoom-in-95 duration-200">
                  <div className="flex flex-col items-center text-center">
                      <div className="w-12 h-12 rounded-full bg-[#ba3b46]/10 flex items-center justify-center mb-4">
                          <AlertCircle className="w-6 h-6 text-[#ba3b46]" />
                      </div>
                      <h3 className="text-lg font-bold text-[#403f4c] mb-2">
                          {isBulkDelete ? `Delete ${selectedIds.size} Records?` : 'Delete Sale Record?'}
                      </h3>
                      <p className="text-sm text-gray-500 mb-6">
                          {isBulkDelete 
                             ? "Are you sure you want to delete all selected records? This cannot be undone."
                             : "Are you sure you want to remove this sale from your database? This action cannot be undone."}
                      </p>
                      <div className="flex w-full gap-3">
                          <button 
                              onClick={closeDeleteModal}
                              className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-[#403f4c] rounded-lg font-medium transition-colors"
                          >
                              Cancel
                          </button>
                          <button 
                              onClick={confirmDelete}
                              className="flex-1 px-4 py-2 bg-[#ba3b46] hover:bg-[#a12f3a] text-white rounded-lg font-medium transition-colors shadow-sm"
                          >
                              Delete
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-[#a58039]/20 flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2 text-[#403f4c]">
              <Filter className="w-4 h-4 text-[#a58039]" />
              <span className="text-sm font-bold uppercase tracking-wide">Filters:</span>
          </div>

          <div className="flex items-center gap-2">
             <select 
                value={filterYear} 
                onChange={(e) => setFilterYear(e.target.value)}
                className="text-sm border-gray-300 rounded-md focus:ring-[#a58039] focus:border-[#a58039] bg-[#F0EDDE] p-1 text-[#403f4c]"
             >
                 <option value="">All Years</option>
                 {uniqueYears.map(y => <option key={y} value={y}>{y}</option>)}
             </select>
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

          <div className="ml-auto flex items-center gap-3">
              {(filterDealer || filterTag || filterYear) && (
                  <button 
                    onClick={() => { setFilterDealer(''); setFilterTag(''); setFilterYear(''); }}
                    className="text-xs text-[#ba3b46] hover:text-red-700 underline"
                  >
                      Clear Filters
                  </button>
              )}
              
              {selectedIds.size > 0 && onBulkDelete && (
                  <button
                    onClick={openBulkDeleteModal}
                    className="flex items-center gap-2 px-3 py-1.5 bg-[#ba3b46] text-white text-xs font-bold rounded-lg hover:bg-[#a12f3a] transition-all shadow-sm animate-in fade-in"
                  >
                      <Trash2 className="w-3 h-3" />
                      Bulk Delete ({selectedIds.size})
                  </button>
              )}
          </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-[#a58039]/20 overflow-hidden">
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
            <thead className="bg-[#a58039]/10 text-[#403f4c] uppercase font-bold tracking-wider">
                <tr>
                <th className="px-4 py-3 w-10">
                    <button 
                        onClick={toggleSelectAll} 
                        className="text-[#403f4c] hover:text-[#a58039] transition-colors"
                        title={selectedIds.size === sortedSales.length ? "Deselect All" : "Select All"}
                    >
                        {selectedIds.size > 0 && selectedIds.size === sortedSales.length ? 
                            <CheckSquare className="w-5 h-5 text-[#a58039]" /> : 
                            <Square className="w-5 h-5 text-gray-400" />
                        }
                    </button>
                </th>
                <th onClick={() => handleSort('year' as SortField)} className="px-6 py-3 cursor-pointer hover:bg-[#a58039]/20">
                    <div className="flex items-center gap-1">Year {getSortIcon('year' as SortField)}</div>
                </th>
                <th onClick={() => handleSort('make')} className="px-6 py-3 cursor-pointer hover:bg-[#a58039]/20">
                    <div className="flex items-center gap-1">Make {getSortIcon('make')}</div>
                </th>
                <th className="px-6 py-3">Model</th>
                <th className="px-6 py-3">Trim</th>
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
                <th onClick={() => handleSort('mileage')} className="px-6 py-3 cursor-pointer hover:bg-[#a58039]/20 text-right">
                    <div className="flex items-center justify-end gap-1">Mileage {getSortIcon('mileage')}</div>
                </th>
                <th className="px-6 py-3 text-right">Actions</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EDDE]">
                {sortedSales.length === 0 ? (
                    <tr>
                        <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
                            No records found matching your filters.
                        </td>
                    </tr>
                ) : (
                    sortedSales.map((sale) => (
                    <tr key={sale.id} className={`hover:bg-[#F0EDDE]/50 transition-colors ${selectedIds.has(sale.id) ? 'bg-[#F0EDDE]/60' : ''}`}>
                        <td className="px-4 py-4">
                            <button 
                                onClick={() => toggleSelectRow(sale.id)} 
                                className="text-[#403f4c] hover:text-[#a58039] transition-colors"
                            >
                                {selectedIds.has(sale.id) ? 
                                    <CheckSquare className="w-5 h-5 text-[#a58039]" /> : 
                                    <Square className="w-5 h-5 text-gray-300" />
                                }
                            </button>
                        </td>
                        <td className="px-6 py-4">
                            <div className="font-medium text-[#403f4c]">{sale.year}</div>
                        </td>
                        <td className="px-6 py-4">
                            <div className="font-medium text-[#403f4c]">{sale.make}</div>
                        </td>
                        <td className="px-6 py-4">
                            <div className="text-[#403f4c]">{sale.model}</div>
                        </td>
                        <td className="px-6 py-4">
                            <div className="text-xs text-[#a58039]">{sale.trim !== 'Unknown' ? sale.trim : ''}</div>
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
                            {(() => {
                              const p = getDisplayPrice(sale);
                              if (p === null) return <span className="text-gray-400">N/A</span>;
                              return (
                                <>
                                  {new Intl.NumberFormat('en-US', { style: 'decimal', maximumFractionDigits: 0 }).format(p)}
                                  <span className="text-xs text-gray-400 ml-1">{displayCurrency}</span>
                                </>
                              );
                            })()}
                            {sale.recordType === RecordType.MARKET_DATA && (
                              <span className="ml-2 text-[10px] font-bold uppercase tracking-wide bg-[#61988e]/10 text-[#61988e] px-2 py-0.5 rounded-full border border-[#61988e]/30">
                                External
                              </span>
                            )}
                        </td>
                        <td className="px-6 py-4 text-gray-600">
                            {sale.dateSold || '-'}
                        </td>
                        <td className="px-6 py-4 text-center">
                            {sale.daysToSell !== null ? (
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
                        <td className="px-6 py-4 text-right font-medium text-[#403f4c]">
                            {sale.mileage !== null ? (
                                new Intl.NumberFormat('en-US', { style: 'decimal', maximumFractionDigits: 0 }).format(sale.mileage)
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
                                onClick={() => openDeleteModal(sale.id)}
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