import React, { useState, useMemo } from 'react';
import {
  Check,
  Edit3,
  Trash2,
  X,
  Search,
  Scale,
  CheckCircle2,
  AlertCircle,
  PackageCheck,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { SplitBill, SplitConfig, SplitSummary } from '../types';
import { calculateBillAmounts } from '../hooks/useBillSplitter';

interface BillGridProps {
  bills: SplitBill[];
  config: SplitConfig;
  summary: SplitSummary;
  onUpdateRow: (id: string, newWeight: number, newRate: number) => void;
  onDeleteRow: (id: string) => void;
  onReconcileDelta: () => void;
  onGenerate: () => void;
}

type RowFilter = 'all' | 'synced' | 'unsynced' | 'over-limit' | 'under-min';
type SortField = 'billNumber' | 'weight' | 'rate' | 'finalBillAmount';

export const BillGrid: React.FC<BillGridProps> = ({
  bills,
  config,
  summary,
  onUpdateRow,
  onDeleteRow,
  onReconcileDelta,
  onGenerate,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editWeight, setEditWeight] = useState<string>('');
  const [editRate, setEditRate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [rowFilter, setRowFilter] = useState<RowFilter>('all');
  const [sortField, setSortField] = useState<SortField>('billNumber');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  // Pagination for high invoice volume (up to 5,000 invoices)
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const startEdit = (bill: SplitBill) => {
    setEditingId(bill.id);
    setEditWeight(bill.weight.toFixed(3));
    setEditRate(bill.rate.toFixed(2));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditWeight('');
    setEditRate('');
  };

  const saveEdit = (id: string) => {
    const parsedWeight = parseFloat(editWeight);
    const parsedRate = parseFloat(editRate);
    if (!isNaN(parsedWeight) && parsedWeight > 0 && !isNaN(parsedRate) && parsedRate > 0) {
      onUpdateRow(id, parsedWeight, parsedRate);
    }
    setEditingId(null);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const filteredBills = useMemo(() => {
    return bills
      .filter((b) => {
        if (rowFilter === 'synced' && b.syncStatus !== 'synced') return false;
        if (rowFilter === 'unsynced' && b.syncStatus === 'synced') return false;
        if (
          rowFilter === 'over-limit' &&
          b.netAmount <= config.maxBillLimit &&
          b.finalBillAmount <= config.maxBillLimit
        ) {
          return false;
        }
        if (
          rowFilter === 'under-min' &&
          (config.minBillLimit <= 0 || b.finalBillAmount >= config.minBillLimit)
        ) {
          return false;
        }
        if (searchQuery.trim() !== '') {
          const q = searchQuery.toLowerCase();
          return (
            String(b.billNumber).includes(q) ||
            b.voucherNo.toLowerCase().includes(q) ||
            b.weight.toFixed(3).includes(q) ||
            b.finalBillAmount.toString().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        const mult = sortAsc ? 1 : -1;
        return (a[sortField] - b[sortField]) * mult;
      });
  }, [bills, rowFilter, searchQuery, sortField, sortAsc, config.maxBillLimit, config.minBillLimit]);

  const totalPages = pageSize === 0 ? 1 : Math.ceil(filteredBills.length / pageSize) || 1;
  const activePage = Math.min(currentPage, totalPages);

  const displayedBills = useMemo(() => {
    if (pageSize === 0) return filteredBills;
    const start = (activePage - 1) * pageSize;
    return filteredBills.slice(start, start + pageSize);
  }, [filteredBills, activePage, pageSize]);

  const formatINR = (val: number, decimals: number = 2) =>
    val.toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

  return (
    <section
      aria-label="Generated Split Bills Output Table"
      className="bg-white border border-slate-200/90 rounded-xl shadow-xs flex flex-col overflow-hidden"
    >
      {/* Top Grid Bar: Status, Search & Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xs font-bold text-slate-900 tracking-tight">
            Invoices ({bills.length.toLocaleString('en-IN')} Total)
          </h2>
          <span className="text-slate-300" aria-hidden="true">·</span>
          <div className="flex items-center gap-1.5 text-xs font-mono tabular-nums">
            {summary.isWeightMatched ? (
              <span className="flex items-center gap-1 text-emerald-700 font-bold">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                Reconciled: {summary.totalWeightGenerated.toLocaleString('en-IN', { minimumFractionDigits: 3 })} g
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-amber-800 font-bold">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                Delta: {summary.weightDelta > 0 ? '+' : ''}
                {summary.weightDelta.toFixed(3)} g
                <button
                  type="button"
                  onClick={onReconcileDelta}
                  className="ml-1.5 px-2 py-0.5 text-[11px] font-sans font-bold text-slate-900 bg-amber-300 hover:bg-amber-400 rounded transition-colors cursor-pointer"
                >
                  Reconcile
                </button>
              </span>
            )}
          </div>
          <span className="hidden sm:inline text-slate-300" aria-hidden="true">·</span>
          <span className="hidden sm:inline text-xs font-mono tabular-nums text-slate-600">
            Limit: ₹{formatINR(config.minBillLimit, 0)}–₹{formatINR(config.maxBillLimit, 0)}
          </span>
        </div>

        {/* Right: Filters & Search */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
          <div className="flex items-center gap-0.5 p-0.5 bg-slate-200/80 rounded-lg overflow-x-auto max-w-full">
            {(
              [
                { id: 'all', label: `All (${bills.length})` },
                {
                  id: 'synced',
                  label: `Synced (${bills.filter((b) => b.syncStatus === 'synced').length})`,
                },
                {
                  id: 'over-limit',
                  label: `> Max (${
                    bills.filter(
                      (b) => b.netAmount > config.maxBillLimit || b.finalBillAmount > config.maxBillLimit
                    ).length
                  })`,
                },
              ] as { id: RowFilter; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setRowFilter(tab.id);
                  setCurrentPage(1);
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all whitespace-nowrap cursor-pointer ${
                  rowFilter === tab.id
                    ? 'bg-white text-slate-950 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative flex-1 sm:flex-none">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search bill #, wt, amt..."
              aria-label="Filter split bills"
              className="h-8 pl-7 pr-6 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-amber-600 w-full sm:w-44"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Dense ERP Data Table with Touch & Mobile Scroll Physics */}
      <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
        <table className="w-full border-collapse text-left min-w-[760px]">
          <thead className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-xs text-slate-700 border-b border-slate-200 text-[11px] font-bold select-none">
            <tr>
              <th className="py-2.5 pl-4 pr-2 whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => handleSort('billNumber')}
                  className="inline-flex items-center gap-1 hover:text-slate-950 cursor-pointer"
                >
                  <span>Bill #</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-400" />
                </button>
              </th>
              <th className="py-2.5 px-2 whitespace-nowrap">Voucher No</th>
              <th className="py-2.5 px-2 text-right whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => handleSort('weight')}
                  className="inline-flex items-center justify-end gap-1 hover:text-slate-950 cursor-pointer ml-auto"
                >
                  <span>Weight (g)</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-400" />
                </button>
              </th>
              <th className="py-2.5 px-2 text-right whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => handleSort('rate')}
                  className="inline-flex items-center justify-end gap-1 hover:text-slate-950 cursor-pointer ml-auto"
                >
                  <span>Rate (₹/g)</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-400" />
                </button>
              </th>
              <th className="py-2.5 px-2 text-right whitespace-nowrap">Amount (₹)</th>
              <th className="py-2.5 px-2 text-right whitespace-nowrap">GST %</th>
              <th className="py-2.5 px-2 text-right whitespace-nowrap">GST Amt (₹)</th>
              <th className="py-2.5 px-2 text-right whitespace-nowrap">Net Amt (₹)</th>
              <th className="py-2.5 px-2 text-right whitespace-nowrap">Round Off</th>
              <th className="py-2.5 px-2 text-right whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => handleSort('finalBillAmount')}
                  className="inline-flex items-center justify-end gap-1 hover:text-slate-950 cursor-pointer ml-auto"
                >
                  <span>Bill Amt (₹)</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-400" />
                </button>
              </th>
              <th className="py-2.5 pl-2 pr-4 text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200/80 text-xs font-mono tabular-nums">
            {displayedBills.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-12 text-center font-sans text-slate-500">
                  <div className="max-w-sm mx-auto space-y-2">
                    <p className="text-sm font-bold text-slate-800">
                      No split invoices match the current filter
                    </p>
                    <p className="text-xs text-slate-500">
                      Click &ldquo;Generate Split Bills&rdquo; in the control panel above.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setRowFilter('all');
                        setSearchQuery('');
                        if (bills.length === 0) onGenerate();
                      }}
                      className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
                    >
                      {bills.length === 0 ? 'Generate Split Bills' : 'Reset Table Filters'}
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              displayedBills.map((bill) => {
                const isEditing = editingId === bill.id;
                const previewAmounts = isEditing
                  ? calculateBillAmounts(
                      parseFloat(editWeight) || bill.weight,
                      parseFloat(editRate) || bill.rate,
                      bill.gstRate
                    )
                  : bill;

                const isOverLimit =
                  previewAmounts.netAmount > config.maxBillLimit ||
                  previewAmounts.finalBillAmount > config.maxBillLimit;
                const isUnderMin =
                  config.minBillLimit > 0 &&
                  previewAmounts.finalBillAmount < config.minBillLimit &&
                  bill.billNumber !== bills.length;

                return (
                  <tr
                    key={bill.id}
                    className={`h-9 transition-colors ${
                      isEditing
                        ? 'bg-amber-50'
                        : isOverLimit
                        ? 'bg-rose-50/70 hover:bg-rose-50'
                        : isUnderMin
                        ? 'bg-amber-50/40 hover:bg-amber-50'
                        : 'hover:bg-slate-50/90'
                    }`}
                  >
                    <td className="py-1.5 pl-4 pr-2 font-bold text-slate-700 whitespace-nowrap">
                      #{String(bill.billNumber).padStart(2, '0')}
                    </td>

                    <td className="py-1.5 px-2 text-slate-600 whitespace-nowrap">
                      <span>{bill.voucherNo}</span>
                      {bill.syncStatus === 'synced' && (
                        <span className="ml-1.5 text-[10px] font-sans text-emerald-700 font-bold">
                          · Synced
                        </span>
                      )}
                    </td>

                    <td className="py-1.5 px-2 text-right font-bold text-slate-900 whitespace-nowrap">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.001"
                          min="0.001"
                          value={editWeight}
                          onChange={(e) => setEditWeight(e.target.value)}
                          aria-label={`Edit weight for Bill #${bill.billNumber}`}
                          className="w-24 h-7 px-1.5 text-right text-xs font-mono bg-white border border-amber-500 rounded focus:outline-none"
                        />
                      ) : (
                        bill.weight.toFixed(3)
                      )}
                    </td>

                    <td className="py-1.5 px-2 text-right text-slate-800 whitespace-nowrap">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.5"
                          min="1"
                          value={editRate}
                          onChange={(e) => setEditRate(e.target.value)}
                          aria-label={`Edit rate for Bill #${bill.billNumber}`}
                          className="w-28 h-7 px-1.5 text-right text-xs font-mono bg-white border border-amber-500 rounded focus:outline-none"
                        />
                      ) : (
                        formatINR(bill.rate, 2)
                      )}
                    </td>

                    <td className="py-1.5 px-2 text-right text-slate-800 whitespace-nowrap">
                      {formatINR(previewAmounts.grossAmount, 2)}
                    </td>

                    <td className="py-1.5 px-2 text-right text-slate-500 whitespace-nowrap">
                      {bill.gstRate.toFixed(1)}%
                    </td>

                    <td className="py-1.5 px-2 text-right text-slate-700 whitespace-nowrap">
                      {formatINR(previewAmounts.gstAmount, 2)}
                    </td>

                    <td className="py-1.5 px-2 text-right text-slate-800 whitespace-nowrap">
                      {formatINR(previewAmounts.netAmount, 2)}
                    </td>

                    <td
                      className={`py-1.5 px-2 text-right whitespace-nowrap ${
                        previewAmounts.roundOff < 0
                          ? 'text-rose-600'
                          : previewAmounts.roundOff > 0
                          ? 'text-emerald-700'
                          : 'text-slate-400'
                      }`}
                    >
                      {previewAmounts.roundOff > 0 ? '+' : ''}
                      {previewAmounts.roundOff.toFixed(2)}
                    </td>

                    <td className="py-1.5 px-2 text-right font-bold text-slate-950 whitespace-nowrap">
                      <span className={isOverLimit ? 'text-rose-700 underline decoration-rose-500' : ''}>
                        ₹{formatINR(previewAmounts.finalBillAmount, 0)}
                      </span>
                      {isOverLimit && (
                        <span className="ml-1 text-[10px] font-sans font-bold text-rose-700">
                          (!Max)
                        </span>
                      )}
                    </td>

                    <td className="py-1.5 pl-2 pr-4 text-right whitespace-nowrap">
                      {isEditing ? (
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => saveEdit(bill.id)}
                            title="Save row"
                            className="p-1 text-emerald-700 hover:bg-emerald-100 rounded transition-colors cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            title="Cancel editing"
                            className="p-1 text-slate-500 hover:bg-slate-200 rounded transition-colors cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(bill)}
                            title="Edit Weight & Rate"
                            className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 rounded transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteRow(bill.id)}
                            title="Delete Bill Row"
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {bills.length > 0 && (
            <tfoot className="sticky bottom-0 z-10 bg-slate-900 text-white text-xs font-mono tabular-nums border-t border-slate-800">
              <tr className="h-10 font-bold">
                <td colSpan={2} className="py-2 pl-4 pr-2 font-sans text-slate-300">
                  BATCH TOTAL ({bills.length.toLocaleString('en-IN')} Bills)
                </td>
                <td className="py-2 px-2 text-right text-amber-300">
                  {summary.totalWeightGenerated.toLocaleString('en-IN', { minimumFractionDigits: 3 })} g
                </td>
                <td className="py-2 px-2 text-right text-slate-300" title="Weighted Average Rate">
                  Avg ₹{formatINR(summary.averageRate, 2)}
                </td>
                <td className="py-2 px-2 text-right text-white">
                  ₹{formatINR(summary.totalTaxableAmount, 2)}
                </td>
                <td className="py-2 px-2 text-right text-slate-400">
                  {config.gstRate.toFixed(1)}%
                </td>
                <td className="py-2 px-2 text-right text-white">
                  ₹{formatINR(summary.totalGstCollected, 2)}
                </td>
                <td className="py-2 px-2 text-right text-slate-200">
                  ₹{formatINR(summary.totalNetAmount, 2)}
                </td>
                <td className="py-2 px-2 text-right text-slate-300">
                  {summary.totalRoundOff > 0 ? '+' : ''}
                  {summary.totalRoundOff.toFixed(2)}
                </td>
                <td className="py-2 px-2 text-right text-amber-300 text-sm font-bold">
                  ₹{formatINR(summary.grandTotalBillAmount, 0)}
                </td>
                <td className="py-2 pl-2 pr-4 text-right font-sans text-[11px] text-slate-400">
                  {summary.allWithinLimit ? 'All OK' : 'Check Range'}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Pagination Bar for Large Invoices */}
      {filteredBills.length > 50 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-600">Rows per page:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="h-7 px-2 bg-white border border-slate-300 rounded font-mono"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
              <option value={0}>All ({filteredBills.length})</option>
            </select>
            <span className="text-slate-400">·</span>
            <span className="text-slate-600 font-mono">
              Showing{' '}
              {pageSize === 0
                ? `1–${filteredBills.length}`
                : `${(activePage - 1) * pageSize + 1}–${Math.min(
                    activePage * pageSize,
                    filteredBills.length
                  )}`}{' '}
              of {filteredBills.length.toLocaleString('en-IN')}
            </span>
          </div>

          {pageSize > 0 && totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={activePage === 1}
                onClick={() => setCurrentPage(1)}
                className="p-1 text-slate-600 hover:bg-slate-200 disabled:opacity-30 rounded cursor-pointer"
                title="First Page"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={activePage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-1 text-slate-600 hover:bg-slate-200 disabled:opacity-30 rounded cursor-pointer"
                title="Previous Page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 font-mono text-slate-800">
                Page {activePage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={activePage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="p-1 text-slate-600 hover:bg-slate-200 disabled:opacity-30 rounded cursor-pointer"
                title="Next Page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={activePage === totalPages}
                onClick={() => setCurrentPage(totalPages)}
                className="p-1 text-slate-600 hover:bg-slate-200 disabled:opacity-30 rounded cursor-pointer"
                title="Last Page"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Live Summary Footer Bar (5 Required Metrics) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-slate-50 border-t border-slate-200">
        <div className="p-3.5">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>Total Weight Generated</span>
            <Scale className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-base font-bold text-slate-900">
              {summary.totalWeightGenerated.toLocaleString('en-IN', { minimumFractionDigits: 3 })} g
            </span>
          </div>
          <div className="mt-1 text-[11px] flex items-center gap-1.5">
            {summary.isWeightMatched ? (
              <span className="text-emerald-700 font-bold">
                100% Exact Match (Δ 0.000 g)
              </span>
            ) : (
              <span className="text-rose-700 font-bold">
                Mismatch Δ {summary.weightDelta > 0 ? '+' : ''}
                {summary.weightDelta.toFixed(3)} g
              </span>
            )}
          </div>
        </div>

        <div className="p-3.5">
          <div className="text-xs text-slate-500 mb-1">Total Taxable Amount</div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900">
            ₹{formatINR(summary.totalTaxableAmount, 2)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono tabular-nums">
            Avg Rate: ₹{formatINR(summary.averageRate, 2)}/g
          </div>
        </div>

        <div className="p-3.5">
          <div className="text-xs text-slate-500 mb-1">
            Total GST ({config.gstRate}%)
          </div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900">
            ₹{formatINR(summary.totalGstCollected, 2)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono tabular-nums">
            CGST ₹{formatINR(summary.totalGstCollected / 2, 2)} · SGST ₹{formatINR(summary.totalGstCollected / 2, 2)}
          </div>
        </div>

        <div className="p-3.5">
          <div className="text-xs text-slate-500 mb-1">Grand Total Bill Amount</div>
          <div className="text-base font-bold font-mono tabular-nums text-amber-800">
            ₹{formatINR(summary.grandTotalBillAmount, 0)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono tabular-nums">
            Range: ₹{formatINR(summary.minSingleBillAmount, 0)}–₹{formatINR(summary.maxSingleBillAmount, 0)}
          </div>
        </div>

        <div className="p-3.5">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>{config.itemName} Stock Balance</span>
            <PackageCheck className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span
              className={`text-base font-bold ${
                summary.closingStockBalance >= 0 ? 'text-slate-900' : 'text-rose-700'
              }`}
            >
              {summary.closingStockBalance.toLocaleString('en-IN', { minimumFractionDigits: 3 })} g
            </span>
            <span className="text-xs text-slate-500">closing</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono tabular-nums">
            Opening: {summary.openingStockBalance.toLocaleString('en-IN', { minimumFractionDigits: 3 })} g
          </div>
        </div>
      </div>
    </section>
  );
};
