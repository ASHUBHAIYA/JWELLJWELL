import React, { useState, useEffect, useMemo } from 'react';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Send,
  Download,
  Plus,
  Trash2,
  Search,
  Check,
  RefreshCw,
  Landmark,
  ArrowRight,
  Sparkles,
  FileCode2,
  Building2,
  FileText,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { BankVoucherEntry, BridgeStatus } from '../types';
import { generateBankVouchersTallyXml, downloadFile } from '../utils/tallyXmlGenerator';
import { getLicenseKey, importToTally } from '../utils/tallyTransport';

const INITIAL_BANK_LEDGERS: string[] = []; // added by the user in the UI

const INITIAL_PARTY_LEDGERS: string[] = []; // added by the user in the UI

interface BankStatementManagerProps {
  bridgeStatus: BridgeStatus;
  onApplyWeightToSplitter?: (weightInGrams: number, note: string) => void;
  currentRate?: number;
  onCloseModal?: () => void;
  isModal?: boolean;
}

export const BankStatementManager: React.FC<BankStatementManagerProps> = ({
  bridgeStatus,
  onApplyWeightToSplitter,
  currentRate = 7540,
  onCloseModal,
  isModal = false,
}) => {
  const [bankLedgers, setBankLedgers] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('bullionsplit_bank_ledgers');
      if (saved) return JSON.parse(saved);
    } catch {}
    return INITIAL_BANK_LEDGERS;
  });

  const [partyLedgers, setPartyLedgers] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('bullionsplit_party_ledgers');
      if (saved) return JSON.parse(saved);
    } catch {}
    return INITIAL_PARTY_LEDGERS;
  });

  useEffect(() => {
    try {
      localStorage.setItem('bullionsplit_bank_ledgers', JSON.stringify(bankLedgers));
    } catch {}
  }, [bankLedgers]);

  useEffect(() => {
    try {
      localStorage.setItem('bullionsplit_party_ledgers', JSON.stringify(partyLedgers));
    } catch {}
  }, [partyLedgers]);

  const [selectedBankLedger, setSelectedBankLedger] = useState<string>(bankLedgers[0] || '');
  const [selectedDefaultParty, setSelectedDefaultParty] = useState<string>(partyLedgers[0] || '');
  const [entries, setEntries] = useState<BankVoucherEntry[]>([]);
  const [pasteText, setPasteText] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'Receipt' | 'Payment'>('all');
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  // Sync state
  const [isPushing, setIsPushing] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [pushStatusMessage, setPushStatusMessage] = useState<string | null>(null);

  // Modal for new bank/party ledger
  const [showNewBankModal, setShowNewBankModal] = useState(false);
  const [newBankName, setNewBankName] = useState('');
  const [showNewPartyModal, setShowNewPartyModal] = useState(false);
  const [newPartyName, setNewPartyName] = useState('');

  // Conversion rates (if user wants to optionally convert to grams)
  const [customRate, setCustomRate] = useState<number>(currentRate);
  const [customGst, setCustomGst] = useState<number>(3);

  const parseWorkbook = (wb: XLSX.WorkBook, sourceName: string) => {
    try {
      const firstSheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[firstSheetName];
      const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      if (!rawRows || rawRows.length === 0) {
        setUploadStatus('The uploaded sheet is empty.');
        return;
      }

      let headerRowIndex = -1;
      let dateCol = -1;
      let descCol = -1;
      let refCol = -1;
      let creditCol = -1;
      let debitCol = -1;

      for (let r = 0; r < Math.min(20, rawRows.length); r++) {
        const row = rawRows[r].map((c) => String(c).trim().toLowerCase());
        for (let c = 0; c < row.length; c++) {
          const val = row[c];
          if (/date|value date|txn date|post date/i.test(val) && dateCol === -1) {
            dateCol = c;
            headerRowIndex = r;
          }
          if (/narration|description|particulars|remarks|details/i.test(val) && descCol === -1) {
            descCol = c;
            headerRowIndex = r;
          }
          if (/chq|ref|utr|reference|cheque|txn id|transaction id/i.test(val) && refCol === -1) {
            refCol = c;
          }
          if (/credit|deposit|cr|receipt/i.test(val) && !/debit/i.test(val) && creditCol === -1) {
            creditCol = c;
            headerRowIndex = r;
          }
          if (/debit|dr|withdrawal|payment/i.test(val) && debitCol === -1) {
            debitCol = c;
            headerRowIndex = r;
          }
        }
        if ((creditCol !== -1 || debitCol !== -1) && (descCol !== -1 || dateCol !== -1)) {
          break;
        }
      }

      const parsed: BankVoucherEntry[] = [];
      const startRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;

      for (let r = startRow; r < rawRows.length; r++) {
        const row = rawRows[r];
        if (!row || row.length === 0) continue;

        let creditVal = 0;
        let debitVal = 0;
        let desc = 'Bank Transaction';
        let dateStr = new Date().toISOString().split('T')[0];
        let refStr = `UTR${Math.floor(10000000 + Math.random() * 90000000)}`;

        if (creditCol >= 0 && row[creditCol] !== undefined) {
          const raw = String(row[creditCol]).replace(/[₹,$\s]/g, '');
          const num = parseFloat(raw);
          if (!isNaN(num) && num > 0) creditVal = num;
        }

        if (debitCol >= 0 && row[debitCol] !== undefined) {
          const raw = String(row[debitCol]).replace(/[₹,$\s]/g, '');
          const num = parseFloat(raw);
          if (!isNaN(num) && num > 0) debitVal = num;
        }

        if (creditVal === 0 && debitVal === 0) {
          for (let c = 0; c < row.length; c++) {
            const raw = String(row[c]).replace(/[₹,$\s]/g, '');
            const num = parseFloat(raw);
            if (!isNaN(num) && num > 100) {
              creditVal = num;
              break;
            }
          }
        }

        if (descCol >= 0 && row[descCol]) {
          desc = String(row[descCol]).trim();
        } else {
          const textCols = row.filter((c) => typeof c === 'string' && c.trim().length > 3 && isNaN(Number(c)));
          if (textCols.length > 0) desc = String(textCols[0]).trim();
        }

        if (dateCol >= 0 && row[dateCol]) {
          const dVal = row[dateCol];
          if (typeof dVal === 'number') {
            const d = new Date((dVal - 25569) * 86400 * 1000);
            if (!isNaN(d.getTime())) {
              dateStr = d.toISOString().split('T')[0];
            }
          } else {
            const rawDate = String(dVal).trim();
            if (rawDate) dateStr = rawDate;
          }
        }

        if (refCol >= 0 && row[refCol]) {
          refStr = String(row[refCol]).trim();
        }

        const isReceipt = creditVal > 0;
        const amount = isReceipt ? creditVal : debitVal;

        if (amount > 0) {
          parsed.push({
            id: `bank-vch-${Date.now()}-${r}`,
            date: dateStr,
            narration: desc,
            refNo: refStr,
            type: isReceipt ? 'Receipt' : 'Payment',
            amount: Math.round(amount * 100) / 100,
            bankLedger: selectedBankLedger,
            partyLedger: selectedDefaultParty,
            selected: true,
            syncStatus: 'idle',
          });
        }
      }

      if (parsed.length > 0) {
        setEntries(parsed);
        setUploadStatus(`Loaded ${parsed.length} bank statement vouchers from "${sourceName}".`);
      } else {
        setUploadStatus('Could not identify transactions in the uploaded sheet.');
      }
    } catch (err: any) {
      setUploadStatus(`Error reading Excel: ${err?.message || 'Invalid format'}`);
    }
  };

  const parseCsvOrText = (raw: string) => {
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    const parsed: BankVoucherEntry[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/date|narration|particulars|description|credit|debit|balance/i.test(line) && i === 0) {
        continue;
      }

      const parts = line.includes('\t')
        ? line.split('\t')
        : line.includes(',')
        ? line.split(',')
        : line.split(/\s{2,}/);

      if (parts.length >= 2) {
        let amount = 0;
        let isReceipt = true;
        let dateStr = new Date().toISOString().split('T')[0];
        let desc = parts[1] || parts[0];
        let ref = `REF-${Math.floor(100000 + Math.random() * 900000)}`;

        for (const p of parts) {
          const cleanP = p.replace(/[₹,$\s]/g, '');
          const num = parseFloat(cleanP);
          if (!isNaN(num) && num > 10) {
            amount = num;
          } else if (/\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{4}/.test(p)) {
            dateStr = p;
          }
        }

        if (/debit|dr|paid|charge|fee|withdrawal/i.test(desc)) {
          isReceipt = false;
        }

        if (amount > 0) {
          parsed.push({
            id: `vch-${Date.now()}-${i}`,
            date: dateStr,
            narration: desc.replace(/^["']|["']$/g, '').trim(),
            refNo: ref,
            type: isReceipt ? 'Receipt' : 'Payment',
            amount: Math.round(amount * 100) / 100,
            bankLedger: selectedBankLedger,
            partyLedger: selectedDefaultParty,
            selected: true,
            syncStatus: 'idle',
          });
        }
      }
    }

    if (parsed.length > 0) {
      setEntries(parsed);
      setPasteText('');
      setUploadStatus(`Parsed ${parsed.length} vouchers from text.`);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const data = new Uint8Array(event.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: 'array' });
      parseWorkbook(wb, file.name);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const toggleSelect = (id: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, selected: !e.selected } : e)));
  };

  const toggleAll = (select: boolean) => {
    setEntries((prev) => prev.map((e) => ({ ...e, selected: select })));
  };

  const updateEntryParty = (id: string, newParty: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, partyLedger: newParty } : e)));
  };

  const updateEntryType = (id: string, newType: 'Receipt' | 'Payment') => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, type: newType } : e)));
  };

  const applyBankLedgerToAll = (ledger: string) => {
    setSelectedBankLedger(ledger);
    setEntries((prev) => prev.map((e) => ({ ...e, bankLedger: ledger })));
  };

  const applyPartyLedgerToAll = (ledger: string) => {
    setSelectedDefaultParty(ledger);
    setEntries((prev) => prev.map((e) => ({ ...e, partyLedger: ledger })));
  };

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false;
      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase();
        return (
          e.narration.toLowerCase().includes(q) ||
          e.refNo.toLowerCase().includes(q) ||
          e.date.includes(q) ||
          e.amount.toString().includes(q) ||
          e.partyLedger.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [entries, typeFilter, searchFilter]);

  const selectedEntries = entries.filter((e) => e.selected);
  const totalReceiptsAmount = selectedEntries
    .filter((e) => e.type === 'Receipt')
    .reduce((acc, e) => acc + e.amount, 0);
  const totalPaymentsAmount = selectedEntries
    .filter((e) => e.type === 'Payment')
    .reduce((acc, e) => acc + e.amount, 0);

  const bankVouchersXml = useMemo(() => {
    return generateBankVouchersTallyXml(entries, bridgeStatus.companyName);
  }, [entries, bridgeStatus.companyName]);

  // Push to Tally Prime via the cloud relay
  const handlePushDirectToTally = async () => {
    if (selectedEntries.length === 0 || isPushing) return;
    if (!bridgeStatus.companyName.trim()) {
      setPushStatusMessage('[!] Enter the Tally company name in Company Settings before pushing.');
      return;
    }
    if (selectedEntries.some((e) => !e.bankLedger?.trim() || !e.partyLedger?.trim())) {
      setPushStatusMessage('[!] Every selected entry needs a bank ledger and a party ledger.');
      return;
    }

    setIsPushing(true);
    setSyncProgress({ current: 0, total: selectedEntries.length });
    setPushStatusMessage(`Dispatching ${selectedEntries.length} Bank Vouchers to Tally Prime (${bridgeStatus.companyName})...`);

    if (!getLicenseKey()) {
      setIsPushing(false);
      setPushStatusMessage('[!] Enter your license key in Company Settings before pushing.');
      return;
    }

    // Push through the cloud relay -> tally-bridge.exe -> Tally (same path for PC and phone)
    const result = await importToTally(bankVouchersXml);
    const imported = result.created + result.altered;
    const isSuccess = result.errors === 0 && imported >= selectedEntries.length;
    const errorMessage = imported > 0 && imported < selectedEntries.length
      ? `Only ${imported} of ${selectedEntries.length} imported. ${result.message}`
      : result.message;

    setSyncProgress({ current: selectedEntries.length, total: selectedEntries.length });

    setEntries((prev) =>
      prev.map((e) =>
        e.selected
          ? { ...e, syncStatus: isSuccess ? 'synced' : 'failed', tallyMasterId: isSuccess ? '—' : 'N/A' }
          : e
      )
    );

    setIsPushing(false);
    if (isSuccess) {
      setPushStatusMessage(`[✓] Imported ${imported} Receipt/Payment vouchers in Tally Company "${bridgeStatus.companyName}"!`);
    } else {
      setPushStatusMessage(`[!] Tally Push: ${errorMessage || 'Ensure tally-bridge.exe is running & company is open.'}`);
    }
  };

  const handleExportBankXml = () => {
    const filename = `tally-bank-vouchers-${new Date().toISOString().split('T')[0]}.xml`;
    downloadFile(bankVouchersXml, filename, 'application/xml;charset=utf-8');
    setPushStatusMessage(`Exported Tally Bank XML (${selectedEntries.length} vouchers) to ${filename}`);
  };

  const taxMultiplier = 1 + (customGst || 3) / 100;
  const effectiveRate = (customRate || currentRate || 7540) * taxMultiplier;
  const calculatedWeightGrams =
    effectiveRate > 0 && totalReceiptsAmount > 0
      ? Math.round((totalReceiptsAmount / effectiveRate) * 1000) / 1000
      : 0;

  const handleApplyBullionSplit = () => {
    if (calculatedWeightGrams > 0 && onApplyWeightToSplitter) {
      onApplyWeightToSplitter(
        calculatedWeightGrams,
        `Bank Statement (${selectedEntries.length} Vouchers, ₹${totalReceiptsAmount.toLocaleString('en-IN')})`
      );
      if (onCloseModal) onCloseModal();
    }
  };

  const downloadSampleTemplate = () => {
    const sampleData = [
      ['Date', 'Particulars / Narration', 'Chq / Ref No', 'Credit / Deposit (INR)', 'Debit / Withdrawal (INR)'],
      ['2026-10-01', 'RTGS - COUNTER BULLION CASH DEPOSIT - A/C 4821', 'UTR9821049182', 450000, ''],
      ['2026-10-01', 'NEFT - SAMPLE PARTY NAME', 'NEFT771920311', 325000, ''],
      ['2026-10-01', 'IMPS / CDM CASH REPAIR & METAL RECEIPT', 'CDM104928110', 215000, ''],
      ['2026-10-01', 'BANK CHARGES & SMS ALERT FEES', 'CHG104928', '', 450],
      ['2026-10-01', 'NEFT PAYMENT TO BULLION REFINERY', 'UTR8491028471', '', 500000],
    ];

    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BankStatement');
    XLSX.writeFile(wb, 'Sample_Jewellery_Bank_Statement.xlsx');
  };

  return (
    <div className="bg-white border border-slate-200/90 rounded-xl shadow-xs overflow-hidden flex flex-col space-y-4 p-4 sm:p-5">
      {/* Top Banner & Mode Info */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-500/10 text-emerald-700 rounded-lg">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900">
                Direct Bank Statement to Tally Uploader
              </h2>
              <p className="text-xs text-slate-500">
                Upload your bank Excel statement directly to Tally Prime as Receipt &amp; Payment vouchers (1:1, no splitting).
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg cursor-pointer shadow-xs transition-colors">
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Bank Statement (.xlsx, .csv)</span>
            <input
              type="file"
              accept=".xlsx, .xls, .csv, .tsv, .txt"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
          <button
            type="button"
            onClick={downloadSampleTemplate}
            className="flex items-center gap-1 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Sample Format</span>
          </button>
        </div>
      </div>

      {/* Ledger Settings Toolbar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-bold text-slate-700">Bank Ledger (Dr/Cr)</label>
            <button
              type="button"
              onClick={() => setShowNewBankModal(true)}
              className="text-[11px] text-amber-700 font-bold hover:underline cursor-pointer"
            >
              + New Bank
            </button>
          </div>
          <select
            value={selectedBankLedger}
            onChange={(e) => applyBankLedgerToAll(e.target.value)}
            className="w-full h-9 px-2 text-xs font-mono font-medium text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-amber-600"
          >
            {bankLedgers.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-bold text-slate-700">
              Party Ledger (Receipt / Payment)
            </label>
            <button
              type="button"
              onClick={() => setShowNewPartyModal(true)}
              className="text-[11px] text-amber-700 font-bold hover:underline cursor-pointer"
            >
              + New Ledger
            </button>
          </div>
          <select
            value={selectedDefaultParty}
            onChange={(e) => applyPartyLedgerToAll(e.target.value)}
            className="w-full h-9 px-2 text-xs font-mono font-medium text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-amber-600"
          >
            {partyLedgers.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">Target Tally Company</label>
          <div className="h-9 px-2.5 flex items-center text-xs font-mono text-slate-800 bg-white border border-slate-300 rounded-lg truncate">
            {bridgeStatus.companyName}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">Connection Port</label>
          <div className="h-9 px-2.5 flex items-center justify-between text-xs font-mono text-slate-800 bg-white border border-slate-300 rounded-lg">
            <span>{bridgeStatus.endpoint}</span>
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                bridgeStatus.connected ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
              }`}
            >
              {bridgeStatus.connected ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
      </div>

      {uploadStatus && (
        <div className="px-3.5 py-2 text-xs bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-lg flex items-center justify-between">
          <span className="font-medium">{uploadStatus}</span>
          <button
            type="button"
            onClick={() => setEntries([])}
            className="text-slate-600 hover:text-rose-700 text-[11px] font-bold cursor-pointer"
          >
            Clear All
          </button>
        </div>
      )}

      {pushStatusMessage && (
        <div className="px-3.5 py-2 text-xs bg-amber-50 border border-amber-300 text-amber-950 rounded-lg font-medium">
          {pushStatusMessage}
        </div>
      )}

      {/* Paste / Direct Input if No File */}
      {entries.length === 0 && (
        <div className="p-6 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 text-center space-y-3">
          <FileSpreadsheet className="w-10 h-10 text-slate-400 mx-auto" />
          <div>
            <h3 className="text-sm font-bold text-slate-800">No Bank Statement Loaded Yet</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
              Select your bank statement Excel file (.xlsx, .xls, .csv) above, or paste transaction rows below.
            </p>
          </div>
          <div className="max-w-xl mx-auto space-y-2">
            <textarea
              rows={3}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste statement rows here (Date, Particulars, Ref, Amount)..."
              className="w-full p-2.5 text-xs font-mono border border-slate-300 rounded-lg bg-white resize-none"
            />
            <button
              type="button"
              onClick={() => parseCsvOrText(pasteText)}
              disabled={!pasteText.trim()}
              className="w-full py-2 text-xs font-bold text-slate-900 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 rounded-lg cursor-pointer"
            >
              Parse &amp; Load Pasted Rows
            </button>
          </div>
        </div>
      )}

      {/* Vouchers Data Table */}
      {entries.length > 0 && (
        <div className="border border-slate-200 rounded-xl overflow-hidden flex flex-col bg-white">
          {/* Table Header Filter Bar */}
          <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900">
                Bank Vouchers ({entries.length})
              </span>
              <span className="text-slate-300">·</span>
              <button
                type="button"
                onClick={() => toggleAll(true)}
                className="text-[11px] text-amber-700 font-bold hover:underline cursor-pointer"
              >
                Select All
              </button>
              <span className="text-slate-300">·</span>
              <button
                type="button"
                onClick={() => toggleAll(false)}
                className="text-[11px] text-slate-500 hover:underline cursor-pointer"
              >
                Deselect
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center p-0.5 bg-slate-200 rounded-md text-xs">
                {(['all', 'Receipt', 'Payment'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTypeFilter(t)}
                    className={`px-2 py-1 rounded cursor-pointer ${
                      typeFilter === t ? 'bg-white font-bold text-slate-950 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    {t === 'all' ? 'All' : `${t}s`}
                  </button>
                ))}
              </div>

              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Search narration/ref..."
                className="h-7 px-2 text-xs border border-slate-300 rounded-md bg-white w-40"
              />
            </div>
          </div>

          {/* Table Body */}
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full border-collapse text-left text-xs font-mono tabular-nums">
              <thead className="sticky top-0 bg-slate-50 text-slate-700 border-b border-slate-200 text-[11px] font-bold">
                <tr>
                  <th className="py-2 pl-3 pr-2 w-8">#</th>
                  <th className="py-2 px-2 whitespace-nowrap">Date</th>
                  <th className="py-2 px-2 whitespace-nowrap">Vch Type</th>
                  <th className="py-2 px-2 whitespace-nowrap">Narration / Particulars</th>
                  <th className="py-2 px-2 whitespace-nowrap">Ref / UTR</th>
                  <th className="py-2 px-2 whitespace-nowrap">Target Party Ledger</th>
                  <th className="py-2 px-2 text-right whitespace-nowrap">Amount (₹)</th>
                  <th className="py-2 pr-3 pl-2 text-center whitespace-nowrap">Sync Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEntries.map((entry, idx) => (
                  <tr
                    key={entry.id}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      entry.selected ? 'bg-amber-50/30' : 'opacity-70'
                    }`}
                  >
                    <td className="py-2 pl-3 pr-2">
                      <input
                        type="checkbox"
                        checked={entry.selected}
                        onChange={() => toggleSelect(entry.id)}
                        className="w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500 cursor-pointer"
                      />
                    </td>
                    <td className="py-2 px-2 text-slate-700 whitespace-nowrap">{entry.date}</td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <select
                        value={entry.type}
                        onChange={(e) => updateEntryType(entry.id, e.target.value as 'Receipt' | 'Payment')}
                        className={`text-[11px] font-bold px-1.5 py-0.5 rounded border ${
                          entry.type === 'Receipt'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-rose-50 text-rose-800 border-rose-200'
                        }`}
                      >
                        <option value="Receipt">Receipt (Credit)</option>
                        <option value="Payment">Payment (Debit)</option>
                      </select>
                    </td>
                    <td className="py-2 px-2 text-slate-900 font-sans font-medium max-w-xs truncate">
                      {entry.narration}
                    </td>
                    <td className="py-2 px-2 text-slate-500 whitespace-nowrap">{entry.refNo}</td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <select
                        value={entry.partyLedger}
                        onChange={(e) => updateEntryParty(entry.id, e.target.value)}
                        className="h-6 px-1.5 text-xs font-mono bg-white border border-slate-200 rounded max-w-[200px] truncate"
                      >
                        {partyLedgers.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td
                      className={`py-2 px-2 text-right font-bold whitespace-nowrap ${
                        entry.type === 'Receipt' ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {entry.type === 'Receipt' ? '+' : '-'}₹{entry.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 pr-3 pl-2 text-center whitespace-nowrap">
                      {entry.syncStatus === 'synced' ? (
                        <span className="text-emerald-700 font-bold flex items-center justify-center gap-1 text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Synced</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">Ready</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Table Summary Footer */}
          <div className="p-3 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
            <div className="flex items-center gap-4">
              <span>
                Selected: <strong className="text-amber-400">{selectedEntries.length}</strong> / {entries.length} Vouchers
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-emerald-400">
                Receipts: +₹{totalReceiptsAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
              {totalPaymentsAmount > 0 && (
                <>
                  <span className="text-slate-500">·</span>
                  <span className="text-rose-400">
                    Payments: -₹{totalPaymentsAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 font-sans">
              <button
                type="button"
                onClick={handleExportBankXml}
                disabled={selectedEntries.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg cursor-pointer"
                title="Download Tally XML for direct import into Tally Prime"
              >
                <FileCode2 className="w-3.5 h-3.5 text-amber-400" />
                <span>Export Bank XML</span>
              </button>

              <button
                type="button"
                onClick={handlePushDirectToTally}
                disabled={isPushing || selectedEntries.length === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 rounded-lg cursor-pointer shadow-xs"
                title="Push all bank vouchers straight to Tally Prime without splitting"
              >
                {isPushing ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>
                  {isPushing
                    ? `Syncing (${syncProgress.current}/${syncProgress.total})...`
                    : `Push ${selectedEntries.length} Vouchers to Tally`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Optional: Bullion Splitter Bridge Accordion if user wants to convert credits to metal */}
      {entries.length > 0 && onApplyWeightToSplitter && (
        <div className="bg-amber-50/70 border border-amber-300/80 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Optional: Convert Bank Deposits into Bullion Split Invoices</span>
            </div>
            <p className="text-[11px] text-slate-600">
              Transfer deposit receipts (₹{totalReceiptsAmount.toLocaleString('en-IN')}) as bullion weight to the bill splitter.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-bold font-mono text-slate-950">
                {calculatedWeightGrams.toFixed(3)} g
              </div>
              <div className="text-[10px] text-slate-500">@ ₹{customRate}/g + 3% GST</div>
            </div>
            <button
              type="button"
              onClick={handleApplyBullionSplit}
              disabled={calculatedWeightGrams <= 0}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-slate-900 bg-amber-300 hover:bg-amber-400 disabled:opacity-50 rounded-lg cursor-pointer"
            >
              <span>Transfer to Splitter</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Modal: Add New Bank Ledger */}
      {showNewBankModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-sm w-full p-4">
            <h3 className="text-xs font-bold text-slate-900 mb-1">Add New Bank Ledger</h3>
            <input
              type="text"
              autoFocus
              value={newBankName}
              onChange={(e) => setNewBankName(e.target.value.toUpperCase())}
              placeholder="e.g. YES BANK CURRENT A/C"
              className="w-full h-8 px-2 text-xs font-mono border border-slate-300 rounded-md mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewBankModal(false)}
                className="px-3 py-1 text-xs text-slate-600 bg-slate-100 rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (newBankName.trim()) {
                    setBankLedgers((prev) => [...prev, newBankName.trim()]);
                    setSelectedBankLedger(newBankName.trim());
                    setNewBankName('');
                    setShowNewBankModal(false);
                  }
                }}
                className="px-3 py-1 text-xs font-bold text-white bg-slate-900 rounded"
              >
                Save Bank
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add New Party Ledger */}
      {showNewPartyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-sm w-full p-4">
            <h3 className="text-xs font-bold text-slate-900 mb-1">Add New Party Ledger</h3>
            <input
              type="text"
              autoFocus
              value={newPartyName}
              onChange={(e) => setNewPartyName(e.target.value.toUpperCase())}
              placeholder="Party / ledger name"
              className="w-full h-8 px-2 text-xs font-mono border border-slate-300 rounded-md mb-3"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewPartyModal(false)}
                className="px-3 py-1 text-xs text-slate-600 bg-slate-100 rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (newPartyName.trim()) {
                    setPartyLedgers((prev) => [...prev, newPartyName.trim()]);
                    setSelectedDefaultParty(newPartyName.trim());
                    setNewPartyName('');
                    setShowNewPartyModal(false);
                  }
                }}
                className="px-3 py-1 text-xs font-bold text-white bg-slate-900 rounded"
              >
                Save Party
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
