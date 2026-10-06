import React, { useState } from 'react';
import {
  Calculator,
  Download,
  FileCode2,
  FileSpreadsheet,
  RotateCcw,
  Send,
  AlertTriangle,
  ChevronDown,
  Plus,
  Trash2,
  Check,
  RefreshCw,
  Landmark,
  Edit2,
} from 'lucide-react';
import { SplitConfig, StockItemPreset } from '../types';

interface BillingFormProps {
  config: SplitConfig;
  setConfig: React.Dispatch<React.SetStateAction<SplitConfig>>;
  postLedgers: string[];
  onAddPostLedger: (name: string) => void;
  onRemovePostLedger: (name: string) => void;
  salesLedgers: string[];
  onAddSalesLedger: (name: string) => void;
  onRemoveSalesLedger: (name: string) => void;
  itemPresets: StockItemPreset[];
  onAddItemPreset: (preset: StockItemPreset) => void;
  onRemoveItemPreset: (name: string) => void;
  onFetchInvoiceFromTally: () => void;
  isFetchingInvoice: boolean;
  onOpenBankImport: () => void;
  onGenerate: () => void;
  onPushToTally: () => void;
  onReset: () => void;
  onExportXml: () => void;
  onExportMastersXml?: () => void;
  onExportExcel: () => void;
  onOpenXmlInspector: () => void;
  onSelectPreset: (preset: StockItemPreset) => void;
  error: string | null;
  lastGeneratedAt: string;
  isPushing: boolean;
  billCount: number;
  bridgeConnected?: boolean;
}

export const BillingForm: React.FC<BillingFormProps> = ({
  config,
  setConfig,
  postLedgers,
  onAddPostLedger,
  onRemovePostLedger,
  salesLedgers,
  onAddSalesLedger,
  onRemoveSalesLedger,
  itemPresets,
  onAddItemPreset,
  onRemoveItemPreset,
  onFetchInvoiceFromTally,
  isFetchingInvoice,
  onOpenBankImport,
  onGenerate,
  onPushToTally,
  onReset,
  onExportXml,
  onExportMastersXml,
  onExportExcel,
  onOpenXmlInspector,
  onSelectPreset,
  error,
  lastGeneratedAt,
  isPushing,
  billCount,
  bridgeConnected = false,
}) => {
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // Modals for adding new items / ledgers
  const [showNewPostModal, setShowNewPostModal] = useState(false);
  const [newPostName, setNewPostName] = useState('');

  const [showNewSalesModal, setShowNewSalesModal] = useState(false);
  const [newSalesName, setNewSalesName] = useState('');

  const [showNewItemModal, setShowNewItemModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemHsn, setNewItemHsn] = useState('7108');
  const [newItemMinRate, setNewItemMinRate] = useState<number>(7500);
  const [newItemMaxRate, setNewItemMaxRate] = useState<number>(7650);
  const [newItemMinLimit, setNewItemMinLimit] = useState<number>(35000);
  const [newItemMaxLimit, setNewItemMaxLimit] = useState<number>(45000);
  const [newItemDefaultWeight, setNewItemDefaultWeight] = useState<number>(50);

  const handleFieldChange = <K extends keyof SplitConfig>(key: K, value: SplitConfig[K]) => {
    setConfig((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleCreatePostLedger = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPostName.trim()) {
      onAddPostLedger(newPostName.trim());
      setNewPostName('');
      setShowNewPostModal(false);
    }
  };

  const handleCreateSalesLedger = (e: React.FormEvent) => {
    e.preventDefault();
    if (newSalesName.trim()) {
      onAddSalesLedger(newSalesName.trim());
      setNewSalesName('');
      setShowNewSalesModal(false);
    }
  };

  const handleCreateItemPreset = (e: React.FormEvent) => {
    e.preventDefault();
    if (newItemName.trim()) {
      onAddItemPreset({
        name: newItemName.trim(),
        hsnCode: newItemHsn.trim() || '7108',
        unit: 'g',
        openingStock: 500,
        defaultMinRate: newItemMinRate,
        defaultMaxRate: newItemMaxRate,
        defaultMinBillLimit: newItemMinLimit,
        defaultMaxBillLimit: newItemMaxLimit,
        defaultTotalWeight: newItemDefaultWeight,
        description: `Bullion / Jewellery Article (${newItemName.trim()})`,
      });
      setNewItemName('');
      setShowNewItemModal(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onGenerate();
  };

  const activePreset = itemPresets.find((p) => p.name === config.itemName);

  return (
    <section
      aria-label="Bill Splitting Configuration Panel"
      className="bg-white border border-slate-200/90 rounded-xl shadow-xs overflow-visible relative"
    >
      {/* Top Bar: Quick Bullion Presets in Grams, Bank Import CTA & Context */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-3 bg-slate-50 border-b border-slate-200 rounded-t-xl">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-800 mr-1">Presets (g):</span>
          <div className="flex flex-wrap items-center gap-1 p-0.5 bg-slate-200/80 rounded-lg">
            {itemPresets.map((preset) => {
              const isSelected = config.itemName === preset.name;
              return (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => onSelectPreset(preset)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap cursor-pointer ${
                    isSelected
                      ? 'bg-white text-slate-950 shadow-xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {preset.name} ({preset.defaultTotalWeight.toFixed(2)} g)
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setShowNewItemModal(true)}
              className="px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:text-amber-950 hover:bg-amber-100/70 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
              title="Add New Custom Metal/Item"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Add Item</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <button
            type="button"
            onClick={onFetchInvoiceFromTally}
            disabled={isFetchingInvoice}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-950 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50"
            title="Fetch Post Accounts, Stock Items, Sales Accounts and latest voucher number from Tally Prime"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-amber-800 ${isFetchingInvoice ? 'animate-spin' : ''}`} />
            <span>{isFetchingInvoice ? 'Fetching Masters...' : 'Fetch from Tally'}</span>
          </button>

          <button
            type="button"
            onClick={onOpenBankImport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-950 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 rounded-lg transition-colors cursor-pointer shadow-xs"
            title="Import Bank Statement Excel (.xlsx, .csv) to auto-fill total weight"
          >
            <Landmark className="w-3.5 h-3.5 text-emerald-700" />
            <span>Import Bank Excel</span>
          </button>

          <div className="flex items-center gap-2 text-slate-500 font-mono tabular-nums">
            <span className="hidden md:inline">HSN {activePreset?.hsnCode ?? '7108'}</span>
            <span className="hidden md:inline" aria-hidden="true">·</span>
            <span className="text-amber-800 font-bold">Up to 5,000 Bills</span>
          </div>
        </div>
      </div>

      {/* Main Responsive Form Grid (with noValidate to allow ANY valid number ranges) */}
      <form noValidate onSubmit={handleSubmit} className="p-4 sm:p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3.5 items-end">
          {/* 1. Post Account Name */}
          <div className="col-span-1">
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="postAccountName"
                className="text-xs font-semibold text-slate-700 truncate"
              >
                Post Account
              </label>
              <button
                type="button"
                onClick={() => setShowNewPostModal(true)}
                className="text-[11px] text-amber-700 hover:text-amber-800 font-bold flex items-center gap-0.5 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>New</span>
              </button>
            </div>
            <select
              id="postAccountName"
              value={config.postAccountName}
              onChange={(e) => {
                if (e.target.value === '__ADD_NEW__') {
                  setShowNewPostModal(true);
                } else {
                  handleFieldChange('postAccountName', e.target.value);
                }
              }}
              className="w-full h-10 px-2.5 text-xs font-medium text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-600 truncate"
            >
              {config.postAccountName && !postLedgers.includes(config.postAccountName) && (
                <option value={config.postAccountName}>{config.postAccountName}</option>
              )}
              {postLedgers.map((ledger) => (
                <option key={ledger} value={ledger}>
                  {ledger}
                </option>
              ))}
              <option value="__ADD_NEW__">+ Add New Account...</option>
            </select>
          </div>

          {/* 2. Item Name */}
          <div className="col-span-1">
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="itemName" className="text-xs font-semibold text-slate-700 truncate">
                Item Name (g)
              </label>
              <button
                type="button"
                onClick={() => setShowNewItemModal(true)}
                className="text-[11px] text-amber-700 hover:text-amber-800 font-bold flex items-center gap-0.5 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>New</span>
              </button>
            </div>
            <select
              id="itemName"
              value={config.itemName}
              onChange={(e) => {
                if (e.target.value === '__ADD_NEW__') {
                  setShowNewItemModal(true);
                } else {
                  const match = itemPresets.find((p) => p.name === e.target.value);
                  if (match) {
                    onSelectPreset(match);
                  } else {
                    handleFieldChange('itemName', e.target.value);
                  }
                }
              }}
              className="w-full h-10 px-2.5 text-xs font-medium text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-600 truncate"
            >
              {config.itemName && !itemPresets.some((p) => p.name === config.itemName) && (
                <option value={config.itemName}>{config.itemName}</option>
              )}
              {itemPresets.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
              <option value="__ADD_NEW__">+ Add New Item...</option>
            </select>
          </div>

          {/* 3. Item Sales Account */}
          <div className="col-span-1">
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="itemSalesAccount"
                className="text-xs font-semibold text-slate-700 truncate"
              >
                Sales Account
              </label>
              <button
                type="button"
                onClick={() => setShowNewSalesModal(true)}
                className="text-[11px] text-amber-700 hover:text-amber-800 font-bold flex items-center gap-0.5 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>New</span>
              </button>
            </div>
            <select
              id="itemSalesAccount"
              value={config.itemSalesAccount}
              onChange={(e) => {
                if (e.target.value === '__ADD_NEW__') {
                  setShowNewSalesModal(true);
                } else {
                  handleFieldChange('itemSalesAccount', e.target.value);
                }
              }}
              className="w-full h-10 px-2.5 text-xs font-medium text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-600 truncate"
            >
              {config.itemSalesAccount && !salesLedgers.includes(config.itemSalesAccount) && (
                <option value={config.itemSalesAccount}>{config.itemSalesAccount}</option>
              )}
              {salesLedgers.map((ledger) => (
                <option key={ledger} value={ledger}>
                  {ledger}
                </option>
              ))}
              <option value="__ADD_NEW__">+ Add New Sales Ledger...</option>
            </select>
          </div>

          {/* 4. Bill Date */}
          <div className="col-span-1">
            <label
              htmlFor="billDate"
              className="block text-xs font-semibold text-slate-700 mb-1.5 truncate"
            >
              Bill Date
            </label>
            <input
              id="billDate"
              type="date"
              value={config.billDate}
              onChange={(e) => handleFieldChange('billDate', e.target.value)}
              className="w-full h-10 px-2.5 text-xs font-mono tabular-nums text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-600"
            />
          </div>

          {/* 5. Bill Amount Range (Min & Max Limit ₹) - Any numeric value supported */}
          <div className="col-span-1 sm:col-span-2 md:col-span-1 lg:col-span-1 xl:col-span-1">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700 truncate">
                Bill Limit (₹ Range)
              </label>
              <span className="text-[11px] text-slate-400 font-mono">Min–Max</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                aria-label="Minimum Bill Limit"
                type="number"
                step="any"
                value={config.minBillLimit === 0 ? '' : config.minBillLimit}
                onChange={(e) => {
                  const val = e.target.value === '' ? 0 : parseFloat(e.target.value);
                  handleFieldChange('minBillLimit', isNaN(val) ? 0 : val);
                }}
                placeholder="Min ₹"
                title="Minimum bill limit (e.g. 35000). Set to 0 or leave empty for ideal organic minimum."
                className="w-full h-10 px-2 text-xs font-mono tabular-nums text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-600"
              />
              <input
                aria-label="Maximum Bill Limit"
                type="number"
                step="any"
                value={config.maxBillLimit === 0 ? '' : config.maxBillLimit}
                onChange={(e) => {
                  const val = e.target.value === '' ? 0 : parseFloat(e.target.value);
                  handleFieldChange('maxBillLimit', isNaN(val) ? 0 : val);
                }}
                placeholder="Max ₹"
                title="Maximum statutory bill limit (e.g. 48500 or 45000)"
                className="w-full h-10 px-2 text-xs font-mono tabular-nums text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-600"
              />
            </div>
          </div>

          {/* 6. Rate Range (₹/g) */}
          <div className="col-span-1 sm:col-span-2 md:col-span-1 lg:col-span-1 xl:col-span-1">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700 truncate">
                Rate Range (₹/g)
              </label>
              <span className="text-[11px] text-slate-400 font-mono">Min–Max</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                aria-label="Minimum Rate per gram"
                type="number"
                step="any"
                value={config.minRate === 0 ? '' : config.minRate}
                onChange={(e) => {
                  const val = e.target.value === '' ? 0 : parseFloat(e.target.value);
                  handleFieldChange('minRate', isNaN(val) ? 0 : val);
                }}
                placeholder="Min"
                title="Minimum unit rate (₹/g)"
                className="w-full h-10 px-1.5 text-xs font-mono tabular-nums text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-600"
              />
              <input
                aria-label="Maximum Rate per gram"
                type="number"
                step="any"
                value={config.maxRate === 0 ? '' : config.maxRate}
                onChange={(e) => {
                  const val = e.target.value === '' ? 0 : parseFloat(e.target.value);
                  handleFieldChange('maxRate', isNaN(val) ? 0 : val);
                }}
                placeholder="Max"
                title="Maximum unit rate (₹/g)"
                className="w-full h-10 px-1.5 text-xs font-mono tabular-nums text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-600"
              />
            </div>
          </div>

          {/* 7. GST Rate (%) */}
          <div className="col-span-1">
            <label
              htmlFor="gstRate"
              className="block text-xs font-semibold text-slate-700 mb-1.5 truncate"
            >
              GST Rate (%)
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="gstRate"
                type="number"
                step="any"
                value={config.gstRate}
                onChange={(e) => handleFieldChange('gstRate', Number(e.target.value) || 0)}
                className="w-full h-10 px-2.5 text-xs font-mono tabular-nums text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-600"
              />
              <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap">
                ({(config.gstRate / 2).toFixed(1)}%×2)
              </span>
            </div>
          </div>

          {/* 8. Total Weight (Strictly in Grams 'g') */}
          <div className="col-span-1">
            <label
              htmlFor="totalWeight"
              className="block text-xs font-bold text-amber-950 mb-1.5 truncate"
            >
              Total Weight (g)
            </label>
            <input
              id="totalWeight"
              type="number"
              step="any"
              value={config.totalWeight === 0 ? '' : config.totalWeight}
              onChange={(e) => {
                const val = e.target.value === '' ? 0 : parseFloat(e.target.value);
                handleFieldChange('totalWeight', isNaN(val) ? 0 : val);
              }}
              className="w-full h-10 px-2.5 text-xs font-mono font-bold tabular-nums text-slate-950 bg-amber-50 border-2 border-amber-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-600 shadow-xs"
            />
          </div>
        </div>

        {/* Validation Error Banner */}
        {error && (
          <div
            role="alert"
            className="mt-3.5 flex items-start gap-2.5 px-4 py-3 text-xs text-rose-900 bg-rose-50 border border-rose-200 rounded-lg"
          >
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span className="font-medium leading-relaxed">{error}</span>
          </div>
        )}

        {/* Action Toolbar Row: Editable Initial Invoice No + Tally Fetch + Split Actions */}
        <div className="mt-5 pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-700">
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200">
              <label htmlFor="voucherPrefix" className="text-slate-600 font-bold pl-1 text-[11px]">
                Invoice Prefix:
              </label>
              <input
                id="voucherPrefix"
                type="text"
                value={config.voucherPrefix}
                onChange={(e) => handleFieldChange('voucherPrefix', e.target.value)}
                placeholder="Voucher prefix"
                title="Invoice Prefix (Editable anytime)"
                className="w-24 h-7 px-2 text-xs font-mono font-bold text-slate-900 bg-white border border-slate-300 rounded focus:border-amber-600 focus:outline-none"
              />
              <label htmlFor="startingBillNo" className="text-slate-600 font-bold pl-1 text-[11px]">
                Start No:
              </label>
              <input
                id="startingBillNo"
                type="number"
                step="1"
                min="1"
                value={config.startingBillNo}
                onChange={(e) => handleFieldChange('startingBillNo', Number(e.target.value) || 1)}
                title="Initial Starting Invoice Number (Editable anytime)"
                className="w-20 h-7 px-2 text-xs font-mono font-bold tabular-nums text-slate-900 bg-white border border-slate-300 rounded focus:border-amber-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={onFetchInvoiceFromTally}
                disabled={isFetchingInvoice}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-slate-900 bg-amber-300 hover:bg-amber-400 border border-amber-400 rounded transition-colors cursor-pointer"
                title="Fetch next sequential invoice number directly from Tally Prime XML"
              >
                <RefreshCw className={`w-3 h-3 ${isFetchingInvoice ? 'animate-spin text-amber-900' : 'text-slate-800'}`} />
                <span>{isFetchingInvoice ? 'Fetching...' : 'Fetch from Tally'}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onReset}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
              <span>Reset</span>
            </button>

            <div className="relative flex-1 sm:flex-none">
              <button
                type="button"
                onClick={() => setExportMenuOpen((prev) => !prev)}
                className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors whitespace-nowrap cursor-pointer shadow-xs"
              >
                <Download className="w-3.5 h-3.5 text-amber-700" />
                <span>Export XML/Excel</span>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${exportMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {exportMenuOpen && (
                <>
                  {/* Backdrop to close menu on outside click */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setExportMenuOpen(false)}
                    aria-hidden="true"
                  />

                  <div
                    className="absolute right-0 top-full mt-1.5 w-72 bg-white border border-slate-200 rounded-xl shadow-2xl ring-1 ring-slate-900/10 py-2 z-50 animate-in fade-in zoom-in-95 duration-100"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setExportMenuOpen(false);
                        if (billCount === 0) onGenerate();
                        setTimeout(() => onExportXml(), 50);
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-left text-slate-700 hover:bg-amber-50 cursor-pointer transition-colors"
                    >
                      <FileCode2 className="w-4 h-4 text-amber-600 shrink-0" />
                      <div>
                        <div className="font-bold text-slate-900">Download Vouchers XML (.xml)</div>
                        <div className="text-[11px] text-slate-500">Alt+Z Sales Vouchers import</div>
                      </div>
                    </button>

                    {onExportMastersXml && (
                      <button
                        type="button"
                        onClick={() => {
                          setExportMenuOpen(false);
                          if (billCount === 0) onGenerate();
                          setTimeout(() => onExportMastersXml(), 50);
                        }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-left text-slate-700 hover:bg-amber-50 cursor-pointer transition-colors"
                      >
                        <FileCode2 className="w-4 h-4 text-blue-600 shrink-0" />
                        <div>
                          <div className="font-bold text-slate-900">Download Masters XML (.xml)</div>
                          <div className="text-[11px] text-slate-500">All Masters: Items, Ledgers & Units</div>
                        </div>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setExportMenuOpen(false);
                        if (billCount === 0) onGenerate();
                        setTimeout(() => onExportExcel(), 50);
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-left text-slate-700 hover:bg-emerald-50 cursor-pointer transition-colors"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                      <div>
                        <div className="font-bold text-slate-900">Export Excel Sheet (.csv)</div>
                        <div className="text-[11px] text-slate-500">All rows + tax & weight summary</div>
                      </div>
                    </button>

                    <div className="my-1.5 border-t border-slate-100" />

                    <button
                      type="button"
                      onClick={() => {
                        setExportMenuOpen(false);
                        onOpenXmlInspector();
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs text-left text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <FileCode2 className="w-4 h-4 text-slate-500 shrink-0" />
                      <span className="font-medium">Inspect Live XML Envelope</span>
                    </button>
                  </div>
                </>
              )}
            </div>

            <button
              type="submit"
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer shadow-xs"
            >
              <Calculator className="w-3.5 h-3.5 text-amber-400" />
              <span>Generate Split Bills</span>
            </button>

            <button
              type="button"
              onClick={onPushToTally}
              disabled={isPushing || billCount === 0 || !bridgeConnected}
              title={
                !bridgeConnected
                  ? 'Tally Bridge is Offline. Please start tally-bridge.exe & open company in Tally.'
                  : billCount === 0
                  ? 'Generate bills first'
                  : 'Push vouchers to open Tally company'
              }
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:hover:bg-amber-400 rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:cursor-not-allowed shadow-xs"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{bridgeConnected ? 'Push to Tally' : 'Tally Offline'}</span>
            </button>
          </div>
        </div>
      </form>

      {/* Modal: Add New Post Account */}
      {showNewPostModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-md w-full p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-1">
              Add New Post Account (Tally Ledger)
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Enter the ledger name. Saved permanently for future sessions.
            </p>
            <form onSubmit={handleCreatePostLedger} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Ledger Name
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newPostName}
                  onChange={(e) => setNewPostName(e.target.value)}
                  placeholder="e.g. VIP Counter Cash / Cash / Sundry Debtors"
                  className="w-full h-9 px-3 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-amber-600"
                />
              </div>

              <div className="pt-2 border-t border-slate-100">
                <span className="text-[11px] font-semibold text-slate-500 uppercase">
                  Existing Saved Ledgers:
                </span>
                <div className="max-h-32 overflow-y-auto mt-1 space-y-1">
                  {postLedgers.map((l) => (
                    <div
                      key={l}
                      className="flex items-center justify-between text-xs py-1 px-2 bg-slate-50 rounded hover:bg-slate-100"
                    >
                      <span className="font-mono text-slate-800">{l}</span>
                      {postLedgers.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onRemovePostLedger(l)}
                          className="text-slate-400 hover:text-rose-600 p-0.5 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewPostModal(false)}
                  className="px-3.5 py-1.5 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newPostName.trim()}
                  className="px-3.5 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save Account</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add New Sales Account */}
      {showNewSalesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-md w-full p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-1">
              Add New Item Sales Account
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Enter the sales ledger name to save in the dropdown for future use.
            </p>
            <form onSubmit={handleCreateSalesLedger} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Sales Ledger Name
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newSalesName}
                  onChange={(e) => setNewSalesName(e.target.value)}
                  placeholder="e.g. Sales / GST Sales 3% / Bullion Sales"
                  className="w-full h-9 px-3 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-amber-600"
                />
              </div>

              <div className="pt-2 border-t border-slate-100">
                <span className="text-[11px] font-semibold text-slate-500 uppercase">
                  Existing Saved Sales Accounts:
                </span>
                <div className="max-h-32 overflow-y-auto mt-1 space-y-1">
                  {salesLedgers.map((l) => (
                    <div
                      key={l}
                      className="flex items-center justify-between text-xs py-1 px-2 bg-slate-50 rounded hover:bg-slate-100"
                    >
                      <span className="font-mono text-slate-800">{l}</span>
                      {salesLedgers.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onRemoveSalesLedger(l)}
                          className="text-slate-400 hover:text-rose-600 p-0.5 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewSalesModal(false)}
                  className="px-3.5 py-1.5 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newSalesName.trim()}
                  className="px-3.5 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save Ledger</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add New Custom Metal Item */}
      {showNewItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-md w-full p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-1">
              Add New Metal / Item (Grams)
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              Configure item name, HSN code, and per-gram rate range.
            </p>
            <form onSubmit={handleCreateItemPreset} className="space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Item Name
                  </label>
                  <input
                    type="text"
                    autoFocus
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    placeholder="e.g. Gold 999 / Silver 999 / Rose Gold"
                    className="w-full h-8 px-2.5 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-amber-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    HSN Code
                  </label>
                  <input
                    type="text"
                    value={newItemHsn}
                    onChange={(e) => setNewItemHsn(e.target.value)}
                    placeholder="7108"
                    className="w-full h-8 px-2.5 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-amber-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Min Rate (₹/g)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={newItemMinRate}
                    onChange={(e) => setNewItemMinRate(Number(e.target.value) || 0)}
                    className="w-full h-8 px-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Max Rate (₹/g)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={newItemMaxRate}
                    onChange={(e) => setNewItemMaxRate(Number(e.target.value) || 0)}
                    className="w-full h-8 px-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Min Bill (₹)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={newItemMinLimit}
                    onChange={(e) => setNewItemMinLimit(Number(e.target.value) || 0)}
                    className="w-full h-8 px-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Max Bill (₹)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={newItemMaxLimit}
                    onChange={(e) => setNewItemMaxLimit(Number(e.target.value) || 0)}
                    className="w-full h-8 px-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Def. Wt (g)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={newItemDefaultWeight}
                    onChange={(e) => setNewItemDefaultWeight(Number(e.target.value) || 0)}
                    className="w-full h-8 px-2 text-xs font-mono border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewItemModal(false)}
                  className="px-3.5 py-1.5 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newItemName.trim()}
                  className="px-3.5 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save Item</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};
