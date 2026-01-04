import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Plus, Sparkles, CheckCircle, X, Tag, List, Trash2, ChevronDown, Bot, Pencil } from 'lucide-react';
import { standardizeVehicleString } from '../services/geminiService';
import { 
    addSavedDealer, getSavedDealers, removeSavedDealer,
    getVehicleDB, addVehicleData, removeMake, removeModel,
    getSavedSubModels, addSavedSubModel, removeSavedSubModel
} from '../services/storageService';
import { CarSale, Currency } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface CarFormProps {
  onSaleAdded: (sale: CarSale) => void;
  onCancel: () => void;
  initialData?: CarSale | null;
}

type FillMode = 'ai' | 'sequence';

// --- Reusable Autocomplete Component ---
interface AutocompleteInputProps {
    label: string;
    value: string;
    onChange: (val: string) => void;
    options: string[];
    placeholder?: string;
    onRemoveOption: (opt: string) => void;
    required?: boolean;
    className?: string;
}

const AutocompleteInput: React.FC<AutocompleteInputProps> = ({ 
    label, value, onChange, options, placeholder, onRemoveOption, required, className 
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const filteredOptions = options.filter(opt => 
        opt.toLowerCase().includes(value.toLowerCase())
    );

    return (
        <div className={`relative ${className}`} ref={wrapperRef}>
            <label className="block text-xs font-bold text-[#403f4c] uppercase tracking-wide">{label}</label>
            <div className="relative mt-1">
                <input 
                    type="text" 
                    value={value} 
                    onChange={e => {
                        onChange(e.target.value);
                        setIsOpen(true);
                    }} 
                    onFocus={() => setIsOpen(true)}
                    placeholder={placeholder}
                    className="w-full p-2 pr-8 border rounded focus:ring-2 focus:ring-[#a58039] focus:border-[#a58039] outline-none border-gray-300" 
                    autoComplete="off"
                    required={required}
                />
                <ChevronDown className="w-4 h-4 text-[#a58039] absolute right-2 top-3 pointer-events-none" />
            </div>
            
            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-[#a58039]/20 rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {value && filteredOptions.length === 0 && (
                        <div className="p-2 text-xs text-gray-400 italic">No existing matches. Will be saved as new.</div>
                    )}
                    {filteredOptions.map(opt => (
                        <div 
                            key={opt} 
                            onClick={() => {
                                onChange(opt);
                                setIsOpen(false);
                            }}
                            className="px-3 py-2 text-sm text-[#403f4c] hover:bg-[#F0EDDE] cursor-pointer flex justify-between items-center group"
                        >
                            <span>{opt}</span>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onRemoveOption(opt);
                                }}
                                className="text-gray-300 hover:text-[#ba3b46] opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                title={`Remove ${opt} from saved list`}
                                type="button"
                            >
                                <Trash2 className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                    {options.length === 0 && !value && (
                        <div className="p-2 text-xs text-gray-400">List is empty.</div>
                    )}
                </div>
            )}
        </div>
    );
};


const CarForm: React.FC<CarFormProps> = ({ onSaleAdded, onCancel, initialData }) => {
  const [fillMode, setFillMode] = useState<FillMode>('ai');
  const [rawInput, setRawInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [step, setStep] = useState<'input' | 'verify'>('input');
  
  // Form State
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [subModel, setSubModel] = useState('');
  const [year, setYear] = useState('');
  const [price, setPrice] = useState<number | ''>('');
  const [currency, setCurrency] = useState<Currency>(Currency.NGN);
  const [dateListed, setDateListed] = useState('');
  const [dateSold, setDateSold] = useState(new Date().toISOString().split('T')[0]);
  const [dealer, setDealer] = useState('');
  
  // Saved Data State
  const [savedDealers, setSavedDealers] = useState<string[]>([]);
  const [vehicleDB, setVehicleDB] = useState<Record<string, string[]>>({});
  const [savedSubModels, setSavedSubModels] = useState<string[]>([]);
  
  // Tag State
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    // Load saved data
    setSavedDealers(getSavedDealers());
    setVehicleDB(getVehicleDB());
    setSavedSubModels(getSavedSubModels());
    
    if (initialData) {
        setStep('verify');
        setMake(initialData.make);
        setModel(initialData.model);
        setSubModel(initialData.subModel);
        setYear(initialData.year);
        setPrice(initialData.price);
        setCurrency(initialData.originalCurrency as Currency);
        setDateListed(initialData.dateListed || '');
        setDateSold(initialData.dateSold || '');
        setDealer(initialData.dealer);
        setTags(initialData.tags || []);
    }
  }, [initialData]);

  // Derived Options
  const makeOptions = Object.keys(vehicleDB).sort();
  // Find key case-insensitive to get models
  const matchedMakeKey = Object.keys(vehicleDB).find(k => k.toLowerCase() === make.toLowerCase());
  const modelOptions = matchedMakeKey ? vehicleDB[matchedMakeKey] : [];

  // --- Handlers ---

  const handleSequenceFill = () => {
     if (!rawInput.trim()) return;
     const parts = rawInput.split(',').map(s => s.trim());
     if (parts[0]) setMake(parts[0]);
     if (parts[1]) setModel(parts[1]);
     if (parts[2]) setSubModel(parts[2]);
     if (parts[3]) setYear(parts[3]);
     if (parts[4]) {
         const numericPrice = parseFloat(parts[4].replace(/[^0-9.]/g, ''));
         if (!isNaN(numericPrice)) setPrice(numericPrice);
     }
     if (parts[5]) setDealer(parts[5]);
     setStep('verify');
  };

  const handleSmartFill = async () => {
    if (!rawInput.trim()) return;
    setIsProcessing(true);
    try {
      const result = await standardizeVehicleString(rawInput);
      setMake(result.make);
      setModel(result.model);
      setSubModel(result.subModel);
      setYear(result.year);
      if (result.price) setPrice(result.price);
      if (result.currency) setCurrency(result.currency as Currency);
      if (result.dealer) setDealer(result.dealer);
      if (result.dateSold) setDateSold(result.dateSold);
      setStep('verify');
    } catch (error) {
      alert("AI Processing failed, please enter details manually.");
      setStep('verify'); 
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAutofill = () => {
      if (fillMode === 'ai') handleSmartFill();
      else handleSequenceFill();
  };

  const handleAddTag = (e?: React.KeyboardEvent) => {
    if (e && e.key !== 'Enter') return;
    e?.preventDefault();
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  // --- Storage Manipulators (Wrapper to update state immediately) ---
  const handleRemoveDealer = (name: string) => {
      removeSavedDealer(name);
      setSavedDealers(getSavedDealers());
  };

  const handleRemoveMake = (makeName: string) => {
      if (confirm(`Delete Make "${makeName}" and all its models?`)) {
        removeMake(makeName);
        setVehicleDB(getVehicleDB());
        if (make === makeName) setMake(''); // Clear field if selected
      }
  };

  const handleRemoveModel = (modelName: string) => {
      if (matchedMakeKey) {
        removeModel(matchedMakeKey, modelName);
        setVehicleDB(getVehicleDB());
        if (model === modelName) setModel('');
      }
  };

  const handleRemoveSubModel = (sub: string) => {
      removeSavedSubModel(sub);
      setSavedSubModels(getSavedSubModels());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!price) {
        alert("Price is required");
        return;
    }

    // Auto-Save New Data
    if (make && model) {
        addVehicleData(make, model);
    }
    if (subModel && subModel !== 'Base' && subModel !== 'Unknown') {
        addSavedSubModel(subModel);
    }
    const finalDealer = dealer.trim() || 'Unknown';
    if (finalDealer !== 'Unknown') {
        addSavedDealer(finalDealer);
    }

    let daysToSell: number | undefined = undefined;
    if (dateListed && dateSold) {
        const listed = new Date(dateListed);
        const sold = new Date(dateSold);
        const diffTime = Math.abs(sold.getTime() - listed.getTime());
        daysToSell = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    const saleData: CarSale = {
      id: initialData ? initialData.id : uuidv4(),
      make,
      model,
      subModel: subModel || 'Base',
      year,
      price: Number(price),
      originalCurrency: currency,
      dateListed,
      dateSold,
      daysToSell,
      dealer: finalDealer,
      tags
    };

    onSaleAdded(saleData);
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg border border-[#a58039]/20 mb-8">
      <h2 className="text-xl font-bold text-[#403f4c] mb-4 flex items-center gap-2">
        {initialData ? <Pencil className="w-5 h-5 text-[#a58039]" /> : <Plus className="w-5 h-5 text-[#a58039]" />}
        {initialData ? 'Edit Sale Record' : 'Record New Sale'}
      </h2>

      {step === 'input' && (
        <div className="space-y-4">
          <div className="flex bg-[#F0EDDE] p-1 rounded-lg w-fit mb-2">
              <button
                onClick={() => setFillMode('ai')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    fillMode === 'ai' ? 'bg-white shadow-sm text-[#a58039]' : 'text-[#403f4c] hover:text-[#a58039]'
                }`}
              >
                  <Bot className="w-3 h-3" />
                  AI Smart Fill
              </button>
              <button
                onClick={() => setFillMode('sequence')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    fillMode === 'sequence' ? 'bg-white shadow-sm text-[#a58039]' : 'text-[#403f4c] hover:text-[#a58039]'
                }`}
              >
                  <List className="w-3 h-3" />
                  Sequence Fill
              </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#403f4c] mb-1">
              {fillMode === 'ai' ? 'Describe the sale' : 'Vehicle Details (Comma Separated)'}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder={fillMode === 'ai' 
                    ? "e.g. 2021 Toyota Camry LE sold by Abuja Cars for 5m NGN" 
                    : "Make, Model, SubModel, Year, Price, Dealer"}
                className="flex-1 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#a58039] focus:border-[#a58039] outline-none"
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAutofill();
                    }
                }}
              />
              <button
                type="button"
                onClick={handleAutofill}
                disabled={isProcessing || !rawInput}
                className="bg-[#403f4c] text-[#F0EDDE] px-4 py-2 rounded-lg hover:bg-[#2d2c35] disabled:opacity-50 flex items-center gap-2 transition-colors min-w-[120px] justify-center"
              >
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {fillMode === 'ai' ? 'Auto-Fill' : 'Parse'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {fillMode === 'ai' 
                ? "Type freely. AI will extract Make, Model, Year, Price, Dealer and Date." 
                : "Sequence: Make, Model, Sub-Model, Year, Price, Dealer"}
            </p>
          </div>
          <div className="flex justify-end pt-2">
             <button onClick={() => setStep('verify')} className="text-sm text-[#a58039] hover:underline">
                Skip and enter manually
             </button>
          </div>
        </div>
      )}

      {step === 'verify' && (
        <form onSubmit={handleSubmit} className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            
            <AutocompleteInput 
                label="Make"
                value={make}
                onChange={(val) => {
                    setMake(val);
                }}
                options={makeOptions}
                onRemoveOption={handleRemoveMake}
                placeholder="e.g. Toyota"
                required
            />
            
            <AutocompleteInput 
                label="Model"
                value={model}
                onChange={setModel}
                options={modelOptions}
                onRemoveOption={handleRemoveModel}
                placeholder={make ? `e.g. ${make === 'Toyota' ? 'Camry' : 'Model'}` : "Select Make first"}
                required
            />

            <AutocompleteInput 
                label="Sub-Model"
                value={subModel}
                onChange={setSubModel}
                options={savedSubModels}
                onRemoveOption={handleRemoveSubModel}
                placeholder="e.g. LE, XSE, AMG"
            />

            <div>
              <label className="block text-xs font-bold text-[#403f4c] uppercase tracking-wide">Year</label>
              <input required type="text" value={year} onChange={e => setYear(e.target.value)} className="w-full p-2 border rounded mt-1 focus:ring-2 focus:ring-[#a58039] focus:border-[#a58039] outline-none border-gray-300" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex gap-2">
                <div className="w-24">
                   <label className="block text-xs font-bold text-[#403f4c] uppercase tracking-wide">Currency</label>
                   <select 
                     value={currency} 
                     onChange={(e) => setCurrency(e.target.value as Currency)}
                     className="w-full p-2 border rounded mt-1 bg-[#F0EDDE] border-gray-300 focus:ring-2 focus:ring-[#a58039] outline-none"
                   >
                     {Object.values(Currency).map(c => <option key={c} value={c}>{c}</option>)}
                   </select>
                </div>
                <div className="flex-1">
                    <label className="block text-xs font-bold text-[#403f4c] uppercase tracking-wide">Sold Price</label>
                    <input required type="number" min="0" value={price} onChange={e => setPrice(Number(e.target.value))} className="w-full p-2 border rounded mt-1 focus:ring-2 focus:ring-[#a58039] focus:border-[#a58039] outline-none border-gray-300" placeholder="0.00" />
                </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <div>
                    <label className="block text-xs font-bold text-[#403f4c] uppercase tracking-wide">Date Listed</label>
                    <input type="date" value={dateListed} onChange={e => setDateListed(e.target.value)} className="w-full p-2 border rounded mt-1 focus:ring-2 focus:ring-[#a58039] focus:border-[#a58039] outline-none border-gray-300" />
                </div>
                <div>
                    <label className="block text-xs font-bold text-[#403f4c] uppercase tracking-wide">Date Sold</label>
                    <input type="date" value={dateSold} onChange={e => setDateSold(e.target.value)} className="w-full p-2 border rounded mt-1 focus:ring-2 focus:ring-[#a58039] focus:border-[#a58039] outline-none border-gray-300" />
                </div>
            </div>
          </div>

          {/* Dealer & Tags */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              <AutocompleteInput 
                label="Dealer / Salesperson"
                value={dealer}
                onChange={setDealer}
                options={savedDealers}
                onRemoveOption={handleRemoveDealer}
                placeholder="Who sold this?"
              />
              
              <div>
                 <label className="block text-xs font-bold text-[#403f4c] uppercase tracking-wide">Tags</label>
                 <div className="relative mt-1">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={handleAddTag}
                            placeholder="Type tag & press enter"
                            className="w-full p-2 border rounded focus:ring-2 focus:ring-[#a58039] focus:border-[#a58039] outline-none border-gray-300"
                        />
                        <button type="button" onClick={() => handleAddTag()} className="px-3 py-2 bg-[#F0EDDE] rounded hover:bg-[#e0ddce] text-[#403f4c]">
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>
                 </div>
                 <div className="flex flex-wrap gap-2 mt-2">
                    {tags.map(tag => (
                        <span key={tag} className="inline-flex items-center gap-1 bg-[#F0EDDE] text-[#403f4c] px-2 py-1 rounded-full text-xs border border-[#a58039]/20">
                            <Tag className="w-3 h-3 text-[#a58039]" />
                            {tag}
                            <button type="button" onClick={() => removeTag(tag)} className="hover:text-[#ba3b46]">
                                <X className="w-3 h-3" />
                            </button>
                        </span>
                    ))}
                 </div>
              </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-[#403f4c] hover:bg-[#F0EDDE] rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-[#61988e] text-white font-medium rounded-lg hover:bg-[#4d7d74] flex items-center gap-2 shadow-sm"
            >
              <CheckCircle className="w-4 h-4" />
              {initialData ? 'Update Sale' : 'Save to Database'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default CarForm;