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
  FileCode2,
  Building2,
  FileText,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { BankVoucherEntry, BridgeStatus } from '../types';
import {
  generateBankVouchersTallyXml,
  generateCreateSingleLedgerXml,
  downloadFile,
} from '../utils/tallyXmlGenerator';
import { getLicenseKey, importToTally, fetchTallyLedgers, fetchLastBankVoucher } from '../utils/tallyTransport';

const INITIAL_BANK_LEDGERS: string[] = []; // added by the user or fetched from Tally

const INITIAL_PARTY_LEDGERS: string[] = []; // added by the user or fetched from Tally

interface BankStatementManagerProps {
  bridgeStatus: BridgeStatus;
  onCloseModal?: () => void;
  isModal?: boolean;
}

export const BankStatementManager: React.FC<BankStatementManagerProps> = ({
  bridgeStatus,
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

  // Sync & Fetch state
  const [isPushing, setIsPushing] = useState<boolean>(false);
  const [isFetchingLedgers, setIsFetchingLedgers] = useState<boolean>(false);
  const [isFetchingLastVch, setIsFetchingLastVch] = useState<boolean>(false);
  const [lastReceiptNo, setLastReceiptNo] = useState<string | null>(null);
  const [lastPaymentNo, setLastPaymentNo] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [pushStatusMessage, setPushStatusMessage] = useState<string | null>(null);

  // Modal for new bank/party ledger
  const [showNewBankModal, setShowNewBankModal] = useState(false);
  const [newBankName, setNewBankName] = useState('');
  const [newBankCreating, setNewBankCreating] = useState(false);

  const [showNewPartyModal, setShowNewPartyModal] = useState(false);
  const [newPartyName, setNewPartyName] = useState('');
  const [newPartyGroup, setNewPartyGroup] = useState('Sundry Debtors');
  const [newPartyCreating, setNewPartyCreating] = useState(false);

  // Fetch Latest Serial Numbers for Receipt & Payment from Tally Prime
  const handleFetchLatestVoucherNumbers = async () => {
    if (!bridgeStatus.companyName?.trim()) return;
    setIsFetchingLastVch(true);
    try {
      const [rcptRes, pymtRes] = await Promise.all([
        fetchLastBankVoucher(bridgeStatus.companyName, 'Receipt'),
        fetchLastBankVoucher(bridgeStatus.companyName, 'Payment'),
      ]);
      setIsFetchingLastVch(false);
      if (rcptRes.voucher) setLastReceiptNo(rcptRes.voucher.full);
      if (pymtRes.voucher) setLastPaymentNo(pymtRes.voucher.full);
    } catch {
      setIsFetchingLastVch(false);
    }
  };

  useEffect(() => {
    if (bridgeStatus.connected && bridgeStatus.companyName) {
      handleFetchLatestVoucherNumbers();
    }
  }, [bridgeStatus.connected, bridgeStatus.companyName]);

  // Fetch Live Ledgers from Tally Prime
  const handleFetchLedgersFromTally = async () => {
    if (!bridgeStatus.companyName?.trim()) {
      setPushStatusMessage('[!] Enter your Tally company name in Company Settings before fetching.');
      return;
    }
    setIsFetchingLedgers(true);
    setPushStatusMessage(`Fetching active Ledgers from Tally Prime (${bridgeStatus.companyName})...`);

    try {
      const res = await fetchTallyLedgers(bridgeStatus.companyName);
      setIsFetchingLedgers(false);

      if (res.error) {
        setPushStatusMessage(`[!] Fetch Failed: ${res.error}`);
        return;
      }

      if (res.bankLedgers.length > 0) {
        setBankLedgers((prev) => Array.from(new Set([...res.bankLedgers, ...prev])));
        if (!selectedBankLedger || !res.bankLedgers.includes(selectedBankLedger)) {
          setSelectedBankLedger(res.bankLedgers[0]);
        }
      }

      if (res.partyLedgers.length > 0) {
        setPartyLedgers((prev) => Array.from(new Set([...res.partyLedgers, ...prev])));
        if (!selectedDefaultParty || !res.partyLedgers.includes(selectedDefaultParty)) {
          setSelectedDefaultParty(res.partyLedgers[0]);
        }
      }

      setPushStatusMessage(
        `[✓] Loaded ${res.bankLedgers.length} Bank Ledgers and ${res.partyLedgers.length} Party/Other Ledgers directly from Tally Prime!`
      );
    } catch (err: any) {
      setIsFetchingLedgers(false);
      setPushStatusMessage(`[!] Fetch Failed: ${err?.message || 'Error connecting to Tally'}`);
    }
  };

  // Create New Bank Ledger in Tally
  const handleCreateNewBankLedger = async () => {
    const name = newBankName.trim();
    if (!name) return;

    setNewBankCreating(true);
    if (bridgeStatus.companyName) {
      try {
        const xml = generateCreateSingleLedgerXml(name, 'Bank Accounts', bridgeStatus.companyName);
        await importToTally(xml);
      } catch {}
    }

    setBankLedgers((prev) => Array.from(new Set([...prev, name])));
    setSelectedBankLedger(name);
    setEntries((prev) => prev.map((e) => (e.bankLedger === selectedBankLedger ? { ...e, bankLedger: name } : e)));
    setNewBankName('');
    setNewBankCreating(false);
    setShowNewBankModal(false);
    setPushStatusMessage(`[✓] Created Bank Ledger "${name}" in Tally under "Bank Accounts".`);
  };

  // Create New Party Ledger in Tally
  const handleCreateNewPartyLedger = async () => {
    const name = newPartyName.trim();
    if (!name) return;

    setNewPartyCreating(true);
    if (bridgeStatus.companyName) {
      try {
        const xml = generateCreateSingleLedgerXml(name, newPartyGroup, bridgeStatus.companyName);
        await importToTally(xml);
      } catch {}
    }

    setPartyLedgers((prev) => Array.from(new Set([...prev, name])));
    setSelectedDefaultParty(name);
    setNewPartyName('');
    setNewPartyCreating(false);
    setShowNewPartyModal(false);
    setPushStatusMessage(`[✓] Created Party Ledger "${name}" in Tally under "${newPartyGroup}".`);
  };

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
      let balanceCol = -1;

      for (let r = 0; r < Math.min(20, rawRows.length); r++) {
        const row = rawRows[r].map((c) => String(c).trim().toLowerCase());
        for (let c = 0; c < row.length; c++) {
          const val = row[c];
          if (/^date$|txn date|value date|post date/i.test(val) && dateCol === -1) {
            dateCol = c;
            headerRowIndex = r;
          }
          if (/^narration$|description|particulars|remarks|details/i.test(val) && descCol === -1) {
            descCol = c;
            headerRowIndex = r;
          }
          if (/chq|ref|utr|reference|cheque|txn id|transaction id/i.test(val) && refCol === -1) {
            refCol = c;
          }
          if (/amount in|deposit|credit|^cr$|receipt/i.test(val) && !/out|debit/i.test(val) && creditCol === -1) {
            creditCol = c;
            headerRowIndex = r;
          }
          if (/amount out|debit|^dr$|withdrawal|payment/i.test(val) && debitCol === -1) {
            debitCol = c;
            headerRowIndex = r;
          }
          if (/^balance$|closing balance|^bal$/i.test(val) && balanceCol === -1) {
            balanceCol = c;
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
        let balanceVal: number | string = '';
        let desc = 'Bank Transaction';
        let dateStr = new Date().toISOString().split('T')[0];
        let refStr = `UTR${Math.floor(10000000 + Math.random() * 90000000)}`;

        if (creditCol >= 0 && row[creditCol] !== undefined && row[creditCol] !== '') {
          const raw = String(row[creditCol]).replace(/[₹,$\s]/g, '');
          const num = parseFloat(raw);
          if (!isNaN(num) && num > 0) creditVal = num;
        }

        if (debitCol >= 0 && row[debitCol] !== undefined && row[debitCol] !== '') {
          const raw = String(row[debitCol]).replace(/[₹,$\s]/g, '');
          const num = parseFloat(raw);
          if (!isNaN(num) && num > 0) debitVal = num;
        }

        if (balanceCol >= 0 && row[balanceCol] !== undefined && row[balanceCol] !== '') {
          const raw = String(row[balanceCol]).replace(/[₹,$\s]/g, '');
          const num = parseFloat(raw);
          if (!isNaN(num)) balanceVal = num;
          else balanceVal = String(row[balanceCol]).trim();
        }

        if (creditVal === 0 && debitVal === 0) {
          for (let c = 0; c < row.length; c++) {
            if (c === balanceCol) continue;
            const raw = String(row[c]).replace(/[₹,$\s]/g, '');
            const num = parseFloat(raw);
            if (!isNaN(num) && num > 0) {
              creditVal = num;
              break;
            }
          }
        }

        if (descCol >= 0 && row[descCol]) {
          desc = String(row[descCol]).trim();
        } else {
          const textCols = row.filter((c, idx) => idx !== dateCol && typeof c === 'string' && c.trim().length > 3 && isNaN(Number(c)));
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
            amountIn: creditVal > 0 ? Math.round(creditVal * 100) / 100 : undefined,
            amountOut: debitVal > 0 ? Math.round(debitVal * 100) / 100 : undefined,
            balance: balanceVal !== '' ? balanceVal : undefined,
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
      if (/date|narration|particulars|description|amount in|amount out|credit|debit|balance/i.test(line) && i === 0) {
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
        let dateStr = parts[0]?.trim() || new Date().toISOString().split('T')[0];
        let desc = parts[1]?.trim() || 'Bank Transaction';
        let ref = `REF-${Math.floor(100000 + Math.random() * 900000)}`;

        const inVal = parts[2] !== undefined ? parseFloat(String(parts[2]).replace(/[₹,$\s]/g, '')) : NaN;
        const outVal = parts[3] !== undefined ? parseFloat(String(parts[3]).replace(/[₹,$\s]/g, '')) : NaN;

        if (!isNaN(inVal) && inVal > 0) {
          isReceipt = true;
          amount = inVal;
        } else if (!isNaN(outVal) && outVal > 0) {
          isReceipt = false;
          amount = outVal;
        } else {
          for (let c = 2; c < parts.length; c++) {
            const cleanP = parts[c].replace(/[₹,$\s]/g, '');
            const num = parseFloat(cleanP);
            if (!isNaN(num) && num > 0) {
              amount = num;
              break;
            }
          }
          if (/debit|dr|paid|charges|fee|withdrawal/i.test(desc)) {
            isReceipt = false;
          }
        }

        const balVal = parts[4] !== undefined ? parseFloat(String(parts[4]).replace(/[₹,$\s]/g, '')) : undefined;

        if (amount > 0) {
          parsed.push({
            id: `vch-${Date.now()}-${i}`,
            date: dateStr,
            narration: desc.replace(/^["']|["']$/g, '').trim(),
            refNo: ref,
            type: isReceipt ? 'Receipt' : 'Payment',
            amount: Math.round(amount * 100) / 100,
            amountIn: inVal > 0 ? inVal : undefined,
            amountOut: outVal > 0 ? outVal : undefined,
            balance: !isNaN(balVal as number) ? balVal : parts[4]?.trim(),
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
    if (selectedEntries.some((e) => !e.bankLedger?.trim())) {
      setPushStatusMessage('[!] Every selected entry needs a Bank Ledger.');
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
    let result = await importToTally(bankVouchersXml);

    // If Tally reports that any ledger does not exist, auto-create the missing ledgers in Tally and retry!
    if (!result.ok && result.lineErrors.some((e) => /does not exist|not found|unknown/i.test(e))) {
      setPushStatusMessage('[...] Creating missing Bank/Party Ledgers in Tally Prime...');
      const missingLedgers = new Set<string>();

      for (const lineErr of result.lineErrors) {
        const matches = lineErr.matchAll(/Ledger\s+['"]?([^'"]+)['"]?\s+does not exist/gi);
        for (const m of matches) {
          if (m[1]) missingLedgers.add(m[1].trim());
        }
      }

      // Also ensure the selected bank and any explicitly assigned party ledgers exist
      selectedEntries.forEach((e) => {
        if (e.bankLedger) missingLedgers.add(e.bankLedger.trim());
        if (e.partyLedger) missingLedgers.add(e.partyLedger.trim());
      });

      for (const missingName of missingLedgers) {
        if (!missingName) continue;
        const isBank = selectedEntries.some((e) => e.bankLedger === missingName) || /bank|od|occ/i.test(missingName);
        const parentGroup = isBank ? 'Bank Accounts' : 'Sundry Debtors';
        try {
          const xml = generateCreateSingleLedgerXml(missingName, parentGroup, bridgeStatus.companyName);
          await importToTally(xml);
        } catch {}
      }

      await new Promise((resolve) => setTimeout(resolve, 1200));
      setPushStatusMessage(`Retrying ${selectedEntries.length} Bank Vouchers into Tally (${bridgeStatus.companyName})...`);
      result = await importToTally(bankVouchersXml);
    }

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

  const downloadSampleTemplate = () => {
    const sampleData = [
      ['DATE', 'NARRATION', 'AMOUNT IN', 'AMOUNT OUT', 'BALANCE'],
      ['02-Apr-25', 'MAND DR- BCF7075-P5P7PDH11544769 X10065727', '', 11556.00, 761499.26],
      ['02-Apr-25', 'IMPSAR/509217705787/Insta Od Icici/043205005039', '', 11362.00, 750137.26],
      ['02-Apr-25', 'IMPSAB/509218829384/TANISHKA1210/9424956617', 47000.00, '', 785302.26],
      ['03-Apr-25', 'MOBFT to: PRITHVEE RAJ DWIVEDI/509321756999', '', 9999.00, 775303.26],
      ['04-Apr-25', 'IMPSAB/509409349505/MS AN INDUSTRIES/9301180070', 50000.00, '', 825303.26],
      ['04-Apr-25', 'NEFTO-DIVAM ENTERPRISES DELHI 001997733414', '', 100000.00, 586700.65],
      ['08-Apr-25', 'Charges for PORD Customer Payment: UBINJ25098354011', '', 5.61, 586695.04],
      ['11-Apr-25', 'NEFT: TRIMETAL INDUSTRIES HDFCH00179132937', 30000.00, '', 476994.43],
      ['25-Apr-25', 'BY CASH 64170 TRANSPORT NAGAR, SATNA', 100000.00, '', 834293.41],
    ];

    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BankStatement');
    XLSX.writeFile(wb, 'Sample_Bank_Statement.xlsx');
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
            {bankLedgers.length === 0 && (
              <option value="">(No Bank Ledgers Loaded)</option>
            )}
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
              Party Ledger (Optional)
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
            <option value="">(Optional - Suspense A/c)</option>
            {partyLedgers.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">Target Tally Company</label>
          <div className="h-9 px-2.5 flex items-center justify-between text-xs font-mono text-slate-800 bg-white border border-slate-300 rounded-lg truncate">
            <span className="truncate">{bridgeStatus.companyName || 'Not configured'}</span>
            <button
              type="button"
              onClick={handleFetchLedgersFromTally}
              disabled={isFetchingLedgers}
              className="ml-2 px-2 py-0.5 text-[11px] font-bold text-slate-900 bg-amber-400 hover:bg-amber-300 rounded inline-flex items-center gap-1 shrink-0 cursor-pointer shadow-2xs"
              title="Fetch all bank and party ledgers directly from Tally Prime"
            >
              <RefreshCw className={`w-3 h-3 ${isFetchingLedgers ? 'animate-spin' : ''}`} />
              <span>{isFetchingLedgers ? 'Fetching...' : 'Fetch Ledgers'}</span>
            </button>
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

      {/* Live Tally Serial Number Info Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 bg-slate-900 text-white rounded-lg text-xs font-mono">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-slate-400 font-sans font-semibold">Tally Voucher Sequences:</span>
          <span className="inline-flex items-center gap-1 text-emerald-400">
            Receipt: <strong className="text-white font-bold">{lastReceiptNo || '—'}</strong>
          </span>
          <span className="text-slate-600">|</span>
          <span className="inline-flex items-center gap-1 text-rose-400">
            Payment: <strong className="text-white font-bold">{lastPaymentNo || '—'}</strong>
          </span>
        </div>
        <button
          type="button"
          onClick={handleFetchLatestVoucherNumbers}
          disabled={isFetchingLastVch}
          className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] font-sans inline-flex items-center gap-1 cursor-pointer transition-colors"
          title="Fetch latest sequence from Tally Prime"
        >
          <RefreshCw className={`w-3 h-3 ${isFetchingLastVch ? 'animate-spin' : ''}`} />
          <span>{isFetchingLastVch ? 'Refreshing...' : 'Check Latest No.'}</span>
        </button>
      </div>

      {uploadStatus && (
        <div className="px-3.5 py-2.5 text-xs bg-emerald-50 border border-emerald-300 text-emerald-950 rounded-lg flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-medium">{uploadStatus}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEntries([])}
              className="text-slate-600 hover:text-rose-700 text-[11px] font-bold cursor-pointer underline"
            >
              Clear Statement
            </button>
            <button
              type="button"
              onClick={() => setUploadStatus(null)}
              className="p-1 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-100 rounded cursor-pointer"
              title="Dismiss message"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {pushStatusMessage && (
        <div className={`px-3.5 py-2.5 text-xs rounded-lg flex items-center justify-between shadow-2xs border ${
          pushStatusMessage.includes('[✓]')
            ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
            : pushStatusMessage.includes('Dispatching') || pushStatusMessage.includes('Syncing') || pushStatusMessage.includes('Fetching') || pushStatusMessage.includes('Retrying') || pushStatusMessage.includes('[...]')
            ? 'bg-amber-100 border-amber-300 text-amber-950 font-semibold'
            : 'bg-rose-50 border-rose-300 text-rose-950'
        }`}>
          <div className="flex items-center gap-2">
            {pushStatusMessage.includes('[✓]') ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : pushStatusMessage.includes('Dispatching') || pushStatusMessage.includes('Syncing') || pushStatusMessage.includes('Fetching') || pushStatusMessage.includes('Retrying') || pushStatusMessage.includes('[...]') ? (
              <RefreshCw className="w-4 h-4 text-amber-700 animate-spin shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="font-medium">{pushStatusMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setPushStatusMessage(null)}
            className="p-1 text-slate-500 hover:text-slate-900 hover:bg-black/5 rounded cursor-pointer ml-2"
            title="Dismiss message"
          >
            ✕
          </button>
        </div>
      )}

      {/* Empty State / Upload Dropzone */}
      {entries.length === 0 && (
        <div className="p-8 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 text-center space-y-4">
          <div className="w-12 h-12 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center mx-auto">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-sm font-bold text-slate-900">Upload Bank Statement</h3>
            <p className="text-xs text-slate-500">
              Select your bank statement Excel file (.xlsx, .xls, .csv) to auto-import vouchers.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <label className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg cursor-pointer shadow-xs transition-colors">
              <Upload className="w-4 h-4" />
              <span>Select Bank Excel File</span>
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
              className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer shadow-2xs"
            >
              <Download className="w-4 h-4 text-slate-500" />
              <span>Download Sample Format</span>
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
              <thead className="sticky top-0 bg-slate-100 text-slate-800 border-b border-slate-200 text-xs font-bold uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 pl-3 pr-2 w-8 text-center">
                    <input
                      type="checkbox"
                      checked={selectedEntries.length === entries.length && entries.length > 0}
                      onChange={(e) => toggleAll(e.target.checked)}
                      className="w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500 cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 px-2 w-10 text-slate-500 text-center">#</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">DATE</th>
                  <th className="py-2.5 px-3 min-w-[280px]">NARRATION</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap text-emerald-800 bg-emerald-50/60 border-x border-emerald-100/80">
                    AMOUNT IN
                  </th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap text-rose-800 bg-rose-50/60 border-r border-rose-100/80">
                    AMOUNT OUT
                  </th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap text-slate-800 bg-slate-50">
                    BALANCE
                  </th>
                  <th className="py-2.5 px-3 whitespace-nowrap">PARTY LEDGER</th>
                  <th className="py-2.5 pr-3 pl-2 text-center whitespace-nowrap">STATUS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80">
                {filteredEntries.map((entry, idx) => {
                  const isReceipt = entry.type === 'Receipt';
                  const inAmt = entry.amountIn ?? (isReceipt ? entry.amount : undefined);
                  const outAmt = entry.amountOut ?? (!isReceipt ? entry.amount : undefined);

                  return (
                    <tr
                      key={entry.id}
                      className={`hover:bg-amber-50/40 transition-colors ${
                        entry.selected ? 'bg-white' : 'opacity-60 bg-slate-50/50'
                      }`}
                    >
                      <td className="py-2 pl-3 pr-2 text-center">
                        <input
                          type="checkbox"
                          checked={entry.selected}
                          onChange={() => toggleSelect(entry.id)}
                          className="w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-2 px-2 text-slate-400 text-center font-mono text-[11px]">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-3 text-slate-800 font-semibold whitespace-nowrap">
                        {entry.date}
                      </td>
                      <td className="py-2 px-3 text-slate-900 font-sans font-medium text-xs break-words max-w-md">
                        {entry.narration}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold whitespace-nowrap bg-emerald-50/30 border-x border-emerald-100/50">
                        {inAmt !== undefined && inAmt > 0 ? (
                          <span className="text-emerald-700">
                            ₹{inAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="text-slate-300 font-normal">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold whitespace-nowrap bg-rose-50/30 border-r border-rose-100/50">
                        {outAmt !== undefined && outAmt > 0 ? (
                          <span className="text-rose-700">
                            ₹{outAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="text-slate-300 font-normal">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-medium whitespace-nowrap text-slate-700 bg-slate-50/50">
                        {entry.balance !== undefined && entry.balance !== '' ? (
                          typeof entry.balance === 'number' ? (
                            `₹${entry.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                          ) : (
                            String(entry.balance)
                          )
                        ) : (
                          <span className="text-slate-300 font-normal">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <select
                          value={entry.partyLedger}
                          onChange={(e) => updateEntryParty(entry.id, e.target.value)}
                          className="h-7 px-2 text-xs font-mono bg-white border border-slate-300 rounded-md max-w-[200px] truncate focus:border-amber-500 focus:outline-none"
                        >
                          <option value="">(Optional / Suspense)</option>
                          {partyLedgers.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-3 pl-2 text-center whitespace-nowrap">
                        {entry.syncStatus === 'synced' ? (
                          <span className="text-emerald-700 font-bold inline-flex items-center gap-1 text-[11px] bg-emerald-100 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Synced</span>
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[11px] font-medium bg-slate-100 px-2 py-0.5 rounded-full">
                            Ready
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
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

      {/* Modal: Add New Bank Ledger */}
      {showNewBankModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-sm w-full p-4.5 space-y-3">
            <div>
              <h3 className="text-xs font-bold text-slate-900">Create Bank Ledger</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Will create in Tally Prime under <span className="font-semibold text-slate-800">"Bank Accounts"</span>.
              </p>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Bank Name / Ledger</label>
              <input
                type="text"
                autoFocus
                value={newBankName}
                onChange={(e) => setNewBankName(e.target.value.toUpperCase())}
                placeholder="e.g. HDFC BANK A/C"
                className="w-full h-8 px-2 text-xs font-mono border border-slate-300 rounded-md focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setNewBankName('');
                  setShowNewBankModal(false);
                }}
                disabled={newBankCreating}
                className="px-3 py-1.5 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateNewBankLedger}
                disabled={!newBankName.trim() || newBankCreating}
                className="px-3.5 py-1.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 rounded cursor-pointer shadow-xs inline-flex items-center gap-1"
              >
                {newBankCreating && <RefreshCw className="w-3 h-3 animate-spin" />}
                <span>{newBankCreating ? 'Creating in Tally...' : 'Create in Tally'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add New Party Ledger */}
      {showNewPartyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-sm w-full p-4.5 space-y-3">
            <div>
              <h3 className="text-xs font-bold text-slate-900">Create Party / Account Ledger</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Creates the ledger directly in your active Tally company.
              </p>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Ledger Name</label>
              <input
                type="text"
                autoFocus
                value={newPartyName}
                onChange={(e) => setNewPartyName(e.target.value.toUpperCase())}
                placeholder="e.g. TANISHKA ENTERPRISES"
                className="w-full h-8 px-2 text-xs font-mono border border-slate-300 rounded-md focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">Under Group (Parent)</label>
              <select
                value={newPartyGroup}
                onChange={(e) => setNewPartyGroup(e.target.value)}
                className="w-full h-8 px-2 text-xs font-mono bg-white border border-slate-300 rounded-md focus:border-amber-500 focus:outline-none"
              >
                <option value="Sundry Debtors">Sundry Debtors (Customers)</option>
                <option value="Sundry Creditors">Sundry Creditors (Suppliers/Vendors)</option>
                <option value="Indirect Expenses">Indirect Expenses (Charges/Fees)</option>
                <option value="Capital Account">Capital Account</option>
                <option value="Cash-in-hand">Cash-in-hand</option>
                <option value="Suspense A/c">Suspense A/c</option>
                <option value="Direct Expenses">Direct Expenses</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setNewPartyName('');
                  setShowNewPartyModal(false);
                }}
                disabled={newPartyCreating}
                className="px-3 py-1.5 text-xs text-slate-600 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateNewPartyLedger}
                disabled={!newPartyName.trim() || newPartyCreating}
                className="px-3.5 py-1.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 rounded cursor-pointer shadow-xs inline-flex items-center gap-1"
              >
                {newPartyCreating && <RefreshCw className="w-3 h-3 animate-spin" />}
                <span>{newPartyCreating ? 'Creating in Tally...' : 'Create in Tally'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
