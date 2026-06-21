import React, { useState, useCallback, useEffect } from 'react';
import { Upload, Image as ImageIcon, X, Loader2, CheckCircle, Save, AlertCircle } from 'lucide-react';
import { extractVehicleDataFromImages } from '../services/geminiService';
import { CarSale, Currency, RecordType } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { getSavedDealers, prepareCarPayload } from '../services/storageService';
import imageCompression from 'browser-image-compression';

interface ImagePair {
    id: string;
    image1: File | null;
    image2: File | null;
    preview1: string | null;
    preview2: string | null;
    status: 'pending' | 'compressing' | 'processing' | 'success' | 'error';
    result?: Partial<CarSale>;
    error?: string;
  }

interface BulkImportProps {
  onSave: (sales: CarSale[]) => Promise<void>;
  currentRates: Record<string, number>;
}

export default function BulkImport({ onSave, currentRates }: BulkImportProps) {
  const [pairs, setPairs] = useState<ImagePair[]>([]);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [existingDealers, setExistingDealers] = useState<string[]>([]);
  const [markAsMarketData, setMarkAsMarketData] = useState(false);

  useEffect(() => {
    setExistingDealers(getSavedDealers());
  }, []);

  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const fileList = e.dataTransfer.files;
    const files: File[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList.item(i);
      if (f && f.type.startsWith('image/')) {
        files.push(f);
      }
    }
    processSelectedFiles(files);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const fileList = e.target.files;
      const files: File[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList.item(i);
        if (f && f.type.startsWith('image/')) {
          files.push(f);
        }
      }
      processSelectedFiles(files);
    }
  };

  const processSelectedFiles = (files: File[]) => {
    // Sort files by name to ensure consistent pairing (assuming names/timestamps indicate order)
    const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));
    
    const newPairs: ImagePair[] = [];
    for (let i = 0; i < sortedFiles.length; i += 2) {
      const file1 = sortedFiles[i];
      const file2 = sortedFiles[i + 1] || null; // Could be odd number of files
      
      newPairs.push({
        id: uuidv4(),
        image1: file1,
        image2: file2,
        preview1: URL.createObjectURL(file1),
        preview2: file2 ? URL.createObjectURL(file2) : null,
        status: 'pending'
      });
    }
    
    setPairs(prev => [...prev, ...newPairs]);
  };

  const removePair = (id: string) => {
    setPairs(prev => {
      const updated = prev.filter(p => p.id !== id);
      // Cleanup object URLs to avoid memory leaks
      const pair = prev.find(p => p.id === id);
      if (pair) {
        if (pair.preview1) URL.revokeObjectURL(pair.preview1);
        if (pair.preview2) URL.revokeObjectURL(pair.preview2);
      }
      return updated;
    });
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Strip the data:image/jpeg;base64, prefix
        resolve(result.split(',')[1]);
      };
      reader.onerror = error => reject(error);
    });
  };

  const processPair = async (pair: ImagePair, onCompressing?: () => void): Promise<ImagePair> => {
    if (!pair.image1 || !pair.image2) {
      return { ...pair, status: 'error', error: 'Missing an image in the pair' };
    }

    try {
      if (onCompressing) onCompressing();
      const options = {
        maxSizeMB: 0.5,
        maxWidthOrHeight: 1920,
        useWebWorker: true
      };

      const compressed1 = await imageCompression(pair.image1, options);
      const compressed2 = await imageCompression(pair.image2, options);

      const base64_1 = await fileToBase64(new File([compressed1], pair.image1.name, { type: compressed1.type }));
      const base64_2 = await fileToBase64(new File([compressed2], pair.image2.name, { type: compressed2.type }));

      const data = await extractVehicleDataFromImages(
        base64_1,
        compressed1.type,
        base64_2,
        compressed2.type
      );

      // Default values to prevent nulls in input fields
      const trimValue = data.trim === data.model ? data.model : (data.trim || 'Base');
      
      // Dealer Normalization
      let dealerValue = data.dealer || 'Unknown';
      if (dealerValue !== 'Unknown') {
        const match = existingDealers.find(d => d.toLowerCase() === dealerValue.toLowerCase());
        if (match) {
          dealerValue = match;
        }
      }

      // Clean up Price output
      let cleanPrice: number | null = null;
      if (data.price !== undefined && data.price !== null) {
          const stripped = String(data.price).replace(/[^0-9.]/g, '');
          const num = Number(stripped);
          if (num > 0 && !isNaN(num)) {
              cleanPrice = num;
          }
      }

      // Sanitize Currency to ensure valid USD base-calculation uses exact enum
      let finalCurrency = Currency.NGN;
      if (data.originalCurrency) {
        const cStr = String(data.originalCurrency).toUpperCase();
        if (cStr.includes('USD') || cStr.includes('$')) finalCurrency = Currency.USD;
        else if (cStr.includes('EUR') || cStr.includes('€')) finalCurrency = Currency.EUR;
        else if (cStr.includes('GBP') || cStr.includes('£')) finalCurrency = Currency.GBP;
      }

      const result: Partial<CarSale> = {
        make: data.make || '',
        model: data.model || '',
        trim: trimValue,
        year: data.year || 'Unknown',
        price: cleanPrice,
        originalCurrency: finalCurrency,
        dateListed: data.dateListed || '',
        dateSold: data.dateSold || '',
        daysToSell: data.daysToSell ?? null,
        mileage: data.mileage ?? null,
        dealer: dealerValue,
        recordType: RecordType.INVENTORY, // default to inventory
        tags: [],
        id: uuidv4()
      };

      return { ...pair, status: 'success', result };
    } catch (err: any) {
      return { ...pair, status: 'error', error: err.message || 'Processing failed' };
    }
  };

  const processAll = async () => {
    setIsProcessingAll(true);
    
    // Process concurrently since we are on a paid tier
    const pendingPairs = pairs.filter(p => p.status !== 'success' && p.status !== 'processing' && p.status !== 'compressing');
    
    // Mark them all as processing initially
    setPairs(prev => prev.map(p => {
      if (pendingPairs.find(pending => pending.id === p.id)) {
        return { ...p, status: 'processing' };
      }
      return p;
    }));

    await Promise.all(pendingPairs.map(async (currentPair) => {
        const updatedPair = await processPair(currentPair, () => {
            setPairs(prev => prev.map(p => p.id === currentPair.id ? { ...p, status: 'compressing' } : p));
        });
        setPairs(prev => prev.map(p => p.id === currentPair.id ? updatedPair : p));
    }));
    
    setIsProcessingAll(false);
  };

  const updateResultField = (id: string, field: keyof CarSale, value: any) => {
    setPairs(prev => prev.map(p => {
      if (p.id === id && p.result) {
        return {
          ...p,
          result: {
            ...p.result,
            [field]: value
          }
        };
      }
      return p;
    }));
  };

  const handleSaveAll = async () => {
    const validResults = pairs
      .filter(p => p.status === 'success' && p.result)
      .map(p => {
        const r = p.result as Partial<CarSale>;
        // Recalculate days to sell if dates are present just in case they were edited manually
        let daysToSell = r.daysToSell;
        if (r.dateListed && r.dateSold) {
          const dListed = new Date(r.dateListed);
          const dSold = new Date(r.dateSold);
          if (!isNaN(dListed.getTime()) && !isNaN(dSold.getTime())) {
             const diffTime = Math.abs(dSold.getTime() - dListed.getTime());
             daysToSell = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          }
        }

        const originalCurrency = r.originalCurrency || Currency.NGN;
        const numericPrice = r.price || null;

        const payloadData: Partial<CarSale> = {
          id: r.id || uuidv4(),
          make: r.make || 'Unknown',
          model: r.model || 'Unknown',
          trim: r.trim || 'Base',
          year: r.year || 'Unknown',
          price: numericPrice,
          originalCurrency: originalCurrency,
          dateListed: r.dateListed,
          dateSold: r.dateSold,
          mileage: r.mileage || null,
          dealer: r.dealer || 'Unknown',
          tags: markAsMarketData ? ['External Data'] : (r.tags || []),
          recordType: markAsMarketData ? RecordType.MARKET_DATA : (r.recordType || RecordType.INVENTORY)
        };
        
        return prepareCarPayload(payloadData, currentRates);
      });

    if (validResults.length === 0) {
      alert("No valid processed records to save.");
      return;
    }

    // Validate that critical data is present (soft warning instead of hard block)
    const invalid = validResults.find(r => !r.make || !r.model || !r.price || r.make === 'Unknown' || r.model === 'Unknown');
    if (invalid) {
      const proceed = window.confirm("Some records have missing information (e.g., Make, Model, or Price). Do you want to proceed and save them anyway?");
      if (!proceed) return;
    }

    setIsSaving(true);
    try {
      await onSave(validResults);
      alert(`Successfully saved ${validResults.length} records!`);
      // Clear processed pairs
      setPairs(prev => prev.filter(p => p.status !== 'success'));
    } catch (e: any) {
      alert('Failed to save: ' + (e.message || JSON.stringify(e)));
    } finally {
      setIsSaving(false);
    }
  };

  const processedCount = pairs.filter(p => p.status === 'success').length;

  return (
    <div className="space-y-6">
      {/* Upload Zone */}
      <div 
        className="border-2 border-dashed border-[#a58039]/40 rounded-xl p-10 bg-white text-center hover:bg-[#F0EDDE]/50 transition-colors cursor-pointer"
        onDragOver={e => e.preventDefault()}
        onDrop={handleFileDrop}
        onClick={() => document.getElementById('bulk-upload-input')?.click()}
      >
        <input 
          id="bulk-upload-input" 
          type="file" 
          multiple 
          accept="image/*" 
          className="hidden" 
          onChange={handleFileInput} 
        />
        <div className="mx-auto w-16 h-16 bg-[#F0EDDE] rounded-full flex items-center justify-center mb-4">
          <Upload className="w-8 h-8 text-[#a58039]" />
        </div>
        <h3 className="text-lg font-bold text-[#403f4c] mb-2">Upload Instagram Screenshots</h3>
        <p className="text-gray-500 max-w-md mx-auto text-sm">
          Drag and drop multiple images here. They will be auto-paired by filename (Pair 1: Image 1 & 2, Pair 2: Image 3 & 4). 
          Image 1 should be the Sold Date highlight, Image 2 the post details.
        </p>
      </div>

      {/* Pairs Staging Area */}
      {pairs.length > 0 && (
        <div className="bg-white p-6 rounded-xl border border-[#a58039]/20 shadow-sm">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-lg font-bold text-[#403f4c]">Staged Pairs ({pairs.length})</h3>
              <p className="text-sm text-gray-500">Review pairings before processing</p>
            </div>
            <button
              onClick={processAll}
              disabled={isProcessingAll || pairs.every(p => p.status === 'success')}
              className="bg-[#61988e] text-white px-5 py-2.5 rounded-lg font-medium hover:bg-[#4f7c74] transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {isProcessingAll ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImageIcon className="w-5 h-5" />}
              {isProcessingAll ? 'Processing...' : 'Process All'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pairs.map((pair, index) => (
              <div key={pair.id} className="border border-gray-200 rounded-lg p-3 relative bg-gray-50">
                <button 
                  onClick={() => removePair(pair.id)}
                  className="absolute -top-2 -right-2 bg-white rounded-full p-1 shadow-md hover:text-red-500 z-20"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2 mb-2 text-xs font-bold text-gray-500 uppercase">
                  <span>Pair {index + 1}</span>
                  {pair.status === 'success' && <CheckCircle className="w-4 h-4 text-green-500 ml-auto" />}
                  {pair.status === 'processing' && <Loader2 className="w-4 h-4 text-[#a58039] animate-spin ml-auto" />}
                  {pair.status === 'compressing' && <div className="ml-auto text-[#a58039] text-xs flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Compressing...</div>}
                  {pair.status === 'error' && (
                    <div className="ml-auto flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500" title={pair.error} />
                      <button 
                        onClick={() => {
                          setPairs(prev => {
                            const next = [...prev];
                            next[index] = { ...next[index], status: 'pending', error: undefined };
                            return next;
                          });
                        }}
                        className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded hover:bg-red-200"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 h-24">
                  <div className="flex-1 bg-gray-200 rounded overflow-hidden flex flex-col relative">
                    <span className="absolute top-1 left-1 bg-black/60 text-white text-[10px] px-1 rounded z-10">Img 1 (Sold)</span>
                    {pair.preview1 ? (
                      <img src={pair.preview1} alt="Preview 1" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">No Image</div>
                    )}
                  </div>
                  <div className="flex-1 bg-gray-200 rounded overflow-hidden flex flex-col relative">
                    <span className="absolute top-1 left-1 bg-black/60 text-white text-[10px] px-1 rounded z-10">Img 2 (Details)</span>
                    {pair.preview2 ? (
                      <img src={pair.preview2} alt="Preview 2" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs text-center">Waiting for pair</div>
                    )}
                  </div>
                </div>
                {pair.error && <p className="text-red-500 text-xs mt-2 truncate" title={pair.error}>{pair.error}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Review Table */}
      {processedCount > 0 && (
        <div className="bg-white rounded-xl border border-[#a58039]/20 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[#F0EDDE]/30">
            <div>
              <h3 className="text-lg font-bold text-[#403f4c]">Review & Edit</h3>
              <p className="text-sm text-gray-500">Fix any AI typos before saving</p>
            </div>
            
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer bg-white px-3 py-2 rounded border border-gray-200 shadow-sm hover:bg-gray-50 transition-colors">
                <input 
                  type="checkbox" 
                  checked={markAsMarketData} 
                  onChange={e => setMarkAsMarketData(e.target.checked)}
                  className="rounded text-[#a58039] focus:ring-[#a58039]"
                />
                <span className="text-sm font-bold text-[#403f4c]">Mark Batch as External Market Data</span>
              </label>

              <button
                onClick={handleSaveAll}
                disabled={isSaving}
                className="bg-[#403f4c] text-white px-5 py-2.5 rounded-lg font-bold hover:bg-[#2d2c35] transition-colors flex items-center gap-2 disabled:opacity-50 shadow-md"
              >
                {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                {isSaving ? 'Saving...' : `Save ${processedCount} to Database`}
              </button>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                <tr>
                  <th className="px-4 py-3">Year</th>
                  <th className="px-4 py-3">Make</th>
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3">Trim</th>
                  <th className="px-4 py-3 w-32">Price</th>
                  <th className="px-4 py-3">List Date</th>
                  <th className="px-4 py-3">Sold Date</th>
                  <th className="px-4 py-3 w-24">Mileage</th>
                  <th className="px-4 py-3">Dealer</th>
                </tr>
              </thead>
              <tbody>
                {pairs.filter(p => p.status === 'success' && p.result).map((pair) => {
                  const res = pair.result!;
                  const isMissingPrice = !res.price;
                  const isMissingMake = !res.make;
                  const isMissingModel = !res.model;

                  return (
                    <tr key={pair.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <input 
                          type="text" 
                          value={res.year || ''} 
                          onChange={e => updateResultField(pair.id, 'year', e.target.value)}
                          className="w-full bg-transparent border-b border-gray-200 focus:border-[#a58039] focus:outline-none py-1"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input 
                          type="text" 
                          value={res.make || ''} 
                          onChange={e => updateResultField(pair.id, 'make', e.target.value)}
                          className={`w-full bg-transparent border-b ${isMissingMake ? 'border-red-500 text-red-600 focus:border-red-600' : 'border-gray-200 focus:border-[#a58039]'} focus:outline-none py-1`}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input 
                          type="text" 
                          value={res.model || ''} 
                          onChange={e => updateResultField(pair.id, 'model', e.target.value)}
                          className={`w-full bg-transparent border-b ${isMissingModel ? 'border-red-500 text-red-600 focus:border-red-600' : 'border-gray-200 focus:border-[#a58039]'} focus:outline-none py-1`}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input 
                          type="text" 
                          value={res.trim || ''} 
                          onChange={e => updateResultField(pair.id, 'trim', e.target.value)}
                          className="w-full bg-transparent border-b border-gray-200 focus:border-[#a58039] focus:outline-none py-1"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center border-b border-gray-200 focus-within:border-[#a58039] transition-colors py-1">
                          <select 
                            value={res.originalCurrency || Currency.NGN}
                            onChange={(e) => updateResultField(pair.id, 'originalCurrency', e.target.value as Currency)}
                            className="bg-transparent text-xs text-[#a58039] font-bold mr-1 outline-none cursor-pointer p-0 appearance-none"
                            title="Currency"
                          >
                            {Object.values(Currency).map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <input 
                            type="text" 
                            value={res.price ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(res.price) : ''} 
                            onChange={e => {
                              const val = e.target.value.replace(/[^0-9]/g, '');
                              const num = Number(val);
                              updateResultField(pair.id, 'price', isNaN(num) || num === 0 ? null : num);
                            }}
                            className={`w-full bg-transparent ${isMissingPrice ? 'text-red-600 placeholder-red-400' : ''} focus:outline-none`}
                            placeholder="Required"
                          />
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <input 
                          type="date" 
                          value={res.dateListed || ''} 
                          onChange={e => updateResultField(pair.id, 'dateListed', e.target.value)}
                          className="w-full bg-transparent border-b border-gray-200 focus:border-[#a58039] focus:outline-none py-1"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input 
                          type="date" 
                          value={res.dateSold || ''} 
                          onChange={e => updateResultField(pair.id, 'dateSold', e.target.value)}
                          className="w-full bg-transparent border-b border-gray-200 focus:border-[#a58039] focus:outline-none py-1"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input 
                          type="text" 
                          value={res.mileage ? new Intl.NumberFormat('en-US').format(res.mileage) : ''} 
                          onChange={e => {
                            const val = e.target.value.replace(/,/g, '');
                            const num = Number(val);
                            updateResultField(pair.id, 'mileage', isNaN(num) ? null : num);
                          }}
                          className="w-full bg-transparent border-b border-gray-200 focus:border-[#a58039] focus:outline-none py-1"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input 
                          type="text" 
                          list="dealer-suggestions"
                          value={res.dealer || ''} 
                          onChange={e => updateResultField(pair.id, 'dealer', e.target.value)}
                          className="w-full bg-transparent border-b border-gray-200 focus:border-[#a58039] focus:outline-none py-1"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <datalist id="dealer-suggestions">
        {existingDealers.map(d => <option key={d} value={d} />)}
      </datalist>
    </div>
  );
}
