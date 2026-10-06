import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Header, ActiveTab } from './components/Header';
import { BillingForm } from './components/BillingForm';
import { BillGrid } from './components/BillGrid';
import { TallySyncDrawer } from './components/TallySyncDrawer';
import { BankStatementModal } from './components/BankStatementModal';
import { BankStatementManager } from './components/BankStatementManager';
import { AdminKeyGenerator } from './components/AdminKeyGenerator';
import { CompanyProfileModal } from './components/CompanyProfileModal';
import {
  StockAndLedgersView,
  SyncLogsView,
} from './components/WorkspaceViews';
import { useBillSplitter } from './hooks/useBillSplitter';
import {
  generateTallyXmlEnvelope,
  generateTallyMastersXml,
  generateExcelCsvContent,
  downloadFile,
  isEducationalMode,
  setEducationalMode,
} from './utils/tallyXmlGenerator';
import {
  getLicenseKey,
  saveLicenseKey,
  importToTally,
  fetchLastSalesVoucher,
  isBridgeOnline,
} from './utils/tallyTransport';
import { BridgeStatus, VoucherSyncLog } from './types';

export default function App() {
  const {
    config,
    setConfig,
    bills,
    setBills,
    error,
    summary,
    lastGeneratedAt,
    stockMap,
    setStockMap,
    postLedgers,
    addPostLedger,
    removePostLedger,
    salesLedgers,
    addSalesLedger,
    removeSalesLedger,
    itemPresets,
    addItemPreset,
    removeItemPreset,
    generateBills,
    updateBillRow,
    deleteBillRow,
    reconcileWeightDelta,
    resetAll,
    applyStockPreset,
  } = useBillSplitter();

  const [activeTab, setActiveTab] = useState<ActiveTab>('workbench');
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [bankModalOpen, setBankModalOpen] = useState<boolean>(false);
  const [adminModalOpen, setAdminModalOpen] = useState<boolean>(false);
  const [showCompanyModal, setShowCompanyModal] = useState<boolean>(() => {
    return !localStorage.getItem('atits_company_configured');
  });

  const [tallyCompany, setTallyCompany] = useState<string>(() => {
    return localStorage.getItem('atits_tally_company') || '';
  });
  const [storeName, setStoreName] = useState<string>(() => {
    return localStorage.getItem('atits_store_name') || '';
  });

  const [licenseKey, setLicenseKeyState] = useState<string>(() => getLicenseKey());
  const [eduMode, setEduMode] = useState<boolean>(() => isEducationalMode());

  const [isPushing, setIsPushing] = useState<boolean>(false);
  const [isFetchingInvoice, setIsFetchingInvoice] = useState<boolean>(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  });
  const [syncLogs, setSyncLogs] = useState<VoucherSyncLog[]>([]);
  const [httpAttemptNotice, setHttpAttemptNotice] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Connects with Windows Background Daemon (tally-bridge.exe on 127.0.0.1:8080 or Cloud Relay)
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({
    connected: false,
    endpoint: '127.0.0.1:8080',
    serviceName: 'tally-bridge.exe (Windows Daemon)',
    mode: 'live-localhost',
    companyName: localStorage.getItem('atits_tally_company') || '',
    lastPingTime: new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    tallyVersion: 'TallyPrime 4.x / ERP 9',
    latencyMs: 0,
  });

  const [tallyProfile, setTallyProfile] = useState<'prime' | 'erp9'>(() =>
    localStorage.getItem('atits_tally_profile') === 'erp9' ? 'erp9' : 'prime'
  );
  const [tallyUnit, setTallyUnit] = useState<string>(() => localStorage.getItem('atits_tally_unit') || 'GMS');
  const [tallyState, setTallyState] = useState<string>(() => localStorage.getItem('atits_tally_state') || '');

  const handleSaveCompanyProfile = (newCompany: string, newStore: string, newLicense: string, newEdu: boolean, newState: string, newProfile: 'prime' | 'erp9', newUnit: string) => {
    setTallyUnit(newUnit);
    localStorage.setItem('atits_tally_unit', newUnit);
    setTallyProfile(newProfile);
    localStorage.setItem('atits_tally_profile', newProfile);
    setTallyState(newState);
    localStorage.setItem('atits_tally_state', newState);
    if (newLicense.trim()) {
      saveLicenseKey(newLicense);
      setLicenseKeyState(newLicense.trim().toUpperCase());
    }
    setEducationalMode(newEdu);
    setEduMode(newEdu);
    setTallyCompany(newCompany);
    setStoreName(newStore);
    localStorage.setItem('atits_tally_company', newCompany);
    localStorage.setItem('atits_store_name', newStore);
    localStorage.setItem('atits_company_configured', 'true');
    setBridgeStatus((prev) => ({
      ...prev,
      companyName: newCompany,
    }));
    setConfig((prev) => ({
      ...prev,
      storeName: newStore,
    }));
    showToast(`Active Tally Company saved: "${newCompany}"`);
  };

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 5000);
  }, []);

  const gstOptions = useMemo(
    () => ({
      stateName: tallyState,
      profile: tallyProfile,
      unitName: tallyUnit,
      hsnByItem: Object.fromEntries(itemPresets.map((p) => [p.name, p.hsnCode])),
    }),
    [tallyState, tallyProfile, tallyUnit, itemPresets]
  );

  const xmlPayload = useMemo(
    () => {
      try {
        return generateTallyXmlEnvelope(bills, config, bridgeStatus.companyName, gstOptions);
      } catch {
        return ''; // names not filled in yet; push is blocked until they are
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bills, config, bridgeStatus.companyName, eduMode, gstOptions]
  );

  const mastersXmlPayload = useMemo(
    () => {
      try {
        return generateTallyMastersXml(bills, bridgeStatus.companyName, config, gstOptions);
      } catch {
        return '';
      }
    },
    [bills, bridgeStatus.companyName, config, gstOptions]
  );

  /**
   * Fetches the latest Sales voucher number from Tally (via cloud relay -> tally-bridge.exe)
   * and sets the next invoice number.
   */
  const handleFetchInvoiceFromTally = useCallback(
    async (silent: boolean = false) => {
      if (!getLicenseKey()) {
        if (!silent) showToast('Enter your license key in Company Settings to connect to Tally.');
        return;
      }

      setIsFetchingInvoice(true);
      const { voucher, error: fetchError } = await fetchLastSalesVoucher(bridgeStatus.companyName);
      setIsFetchingInvoice(false);

      if (voucher) {
        const next = voucher.lastNumber + 1;
        setBridgeStatus((prev) => ({ ...prev, connected: true }));
        setConfig((prev) => ({ ...prev, voucherPrefix: voucher.prefix, startingBillNo: next }));
        setBills((prev) =>
          prev.map((b, idx) => ({ ...b, voucherNo: `${voucher.prefix}${next + idx}` }))
        );
        if (!silent) {
          showToast(`Connected to Tally (${bridgeStatus.companyName}) · Last: ${voucher.full} · Next: ${voucher.prefix}${next}`);
        }
      } else if (fetchError) {
        if (!silent) showToast(`Could not read last invoice: ${fetchError}`);
      } else {
        setBridgeStatus((prev) => ({ ...prev, connected: true }));
        if (!silent) showToast('Connected. No Sales vouchers found this financial year — using your configured starting number.');
      }
    },
    [bridgeStatus.companyName, setConfig, setBills, showToast]
  );

  /**
   * Bridge heartbeat check (the bridge polls the cloud relay, so this works from PC and phone alike).
   */
  const probeTallyConnection = useCallback(
    async (_endpoint: string, silent: boolean = false) => {
      const t0 = performance.now();
      const currentTime = new Date().toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const hasKey = !!getLicenseKey();
      const online = hasKey ? await isBridgeOnline() : false;
      setBridgeStatus((prev) => ({
        ...prev,
        connected: online,
        mode: 'live-localhost',
        lastPingTime: currentTime,
        latencyMs: online ? Math.round(performance.now() - t0) : prev.latencyMs,
      }));
      if (!silent) {
        showToast(
          !hasKey
            ? 'Enter your license key in Company Settings.'
            : online
            ? 'Tally Bridge online (via cloud relay).'
            : 'Bridge offline: start tally-bridge.exe on the shop PC and open the company in Tally.'
        );
      }
      return online;
    },
    [showToast]
  );

  // Initial mount: probe bridge and fetch invoice sequence
  useEffect(() => {
    probeTallyConnection(bridgeStatus.endpoint, true).then((online) => {
      if (online) handleFetchInvoiceFromTally(true);
    });
  }, [bridgeStatus.endpoint, probeTallyConnection, handleFetchInvoiceFromTally]);

  const handleToggleBridgeConnection = useCallback(() => {
    handleFetchInvoiceFromTally(false);
  }, [handleFetchInvoiceFromTally]);

  const handlePingBridge = useCallback(async () => {
    const online = await probeTallyConnection(bridgeStatus.endpoint, false);
    if (online) handleFetchInvoiceFromTally(false);
  }, [bridgeStatus.endpoint, probeTallyConnection, handleFetchInvoiceFromTally]);

  /**
   * 2-Step Sync Pipeline (via cloud relay):
   * Step 1: Create / verify Tally Masters (Units, Ledgers & Stock Items)
   * Step 2: Import Sales Vouchers — results come from Tally's real response, not assumed.
   */
  const handlePushToTally = useCallback(async () => {
    if (!getLicenseKey()) {
      showToast('Enter your license key in Company Settings before pushing.');
      setShowCompanyModal(true);
      return;
    }
    if (!tallyState.trim()) {
      showToast('Enter the company State (as in Tally) in Company Settings before pushing.');
      setShowCompanyModal(true);
      return;
    }
    if (!xmlPayload || !mastersXmlPayload) {
      showToast('XML could not be generated: check HSN code on the stock item and the ledger names.');
      return;
    }
    if (!bridgeStatus.companyName.trim()) {
      showToast('Enter the Tally company name in Company Settings before pushing.');
      setShowCompanyModal(true);
      return;
    }
    if (bills.some((b) => !b.postAccountName?.trim() || !b.itemName?.trim() || !b.itemSalesAccount?.trim())) {
      showToast('Select the party ledger, stock item and sales ledger before pushing.');
      return;
    }
    if (!bridgeStatus.connected) {
      showToast('Cannot Push: bridge is offline. Start tally-bridge.exe and open your company in Tally.');
      return;
    }
    if (bills.length === 0 || isPushing) return;

    setDrawerOpen(true);
    setIsPushing(true);
    setSyncProgress({ current: 0, total: bills.length });

    setHttpAttemptNotice(`Dispatching ${bills.length} Sales Vouchers into Company "${bridgeStatus.companyName}"...`);
    let vRes = await importToTally(xmlPayload);

    // If Tally reports missing masters / ledgers, create masters once and retry vouchers
    if (!vRes.ok && vRes.lineErrors.some((e) => /does not exist|not found|unknown|master/i.test(e))) {
      setHttpAttemptNotice('Creating missing Tally Masters (Units, Ledgers & Stock Items)...');
      await importToTally(mastersXmlPayload);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setHttpAttemptNotice(`Retrying ${bills.length} Sales Vouchers into Company "${bridgeStatus.companyName}"...`);
      vRes = await importToTally(xmlPayload);
    }

    const imported = vRes.created + vRes.altered;
    const allOk = vRes.errors === 0 && imported >= bills.length;
    let failMessage = vRes.message;
    if (!allOk && imported > 0 && imported < bills.length) {
      failMessage = `Only ${imported} of ${bills.length} imported. ${vRes.message}`;
    }
    if (!allOk && isEducationalMode() === false && /date|educational/i.test(vRes.raw)) {
      failMessage += ' (If this Tally is in Educational mode, turn on "Educational mode" in Company Settings.)';
    }

    setHttpAttemptNotice(
      allOk
        ? `[✓] Sync Complete: Imported ${imported} Sales Vouchers in Company "${bridgeStatus.companyName}"!`
        : `[!] Tally Error: ${failMessage}`
    );

    const stamp = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const newLogs: VoucherSyncLog[] = bills.map((b, i) => {
      const isOverLimit = b.netAmount > config.maxBillLimit || b.finalBillAmount > config.maxBillLimit;
      const voucherSuccess = allOk && !isOverLimit;
      return {
        id: `sync-${Date.now()}-${i}`,
        voucherNo: b.voucherNo,
        billNumber: b.billNumber,
        itemName: b.itemName,
        weight: b.weight,
        rate: b.rate,
        finalBillAmount: b.finalBillAmount,
        status: voucherSuccess ? 'success' : 'error',
        tallyMasterId: voucherSuccess ? '—' : 'N/A',
        message: isOverLimit
          ? `Rejected: Bill ₹${b.finalBillAmount.toLocaleString('en-IN')} exceeds limit`
          : voucherSuccess
          ? `Imported in Tally (${bridgeStatus.companyName})`
          : `Failed: ${failMessage}`,
        timestamp: stamp,
        transportMode: 'localhost-live',
      };
    });
    setSyncLogs((prev) => [...newLogs.reverse(), ...prev].slice(0, 500));
    setSyncProgress({ current: bills.length, total: bills.length });
    setIsPushing(false);
  }, [
    bills,
    isPushing,
    bridgeStatus.companyName,
    bridgeStatus.connected,
    xmlPayload,
    mastersXmlPayload,
    config.maxBillLimit,
    showToast,
  ]);

  const handleExportXml = useCallback(() => {
    const filename = `TALLY_VOUCHERS_${config.billDate.replace(/-/g, '')}_${bills.length}_BILLS.xml`;
    downloadFile(xmlPayload, filename, 'application/xml');
    showToast(`Saved Tally Vouchers XML (${bills.length} vouchers). Ready for Alt+Z import in Tally.`);
  }, [bills.length, config.billDate, showToast, xmlPayload]);

  const handleExportMastersXml = useCallback(() => {
    const filename = `TALLY_MASTERS_${config.billDate.replace(/-/g, '')}.xml`;
    downloadFile(mastersXmlPayload, filename, 'application/xml');
    showToast(`Saved Tally Masters XML (Units, Ledgers & Stock Items). Ready for Alt+Z import in Tally.`);
  }, [config.billDate, mastersXmlPayload, showToast]);

  const handleExportExcel = useCallback(() => {
    const content = generateExcelCsvContent(bills, summary, config);
    const filename = `ATITS_BILLS_${config.billDate}_${bills.length}ROWS.csv`;
    downloadFile(content, filename, 'text/csv;charset=utf-8;');
    showToast(`Saved CSV spreadsheet with ${bills.length} bill rows.`);
  }, [bills, summary, config, showToast]);

  const unsyncedCount = useMemo(
    () => bills.filter((b) => b.syncStatus !== 'synced').length,
    [bills]
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-900">
      {/* Top Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        bridgeStatus={bridgeStatus}
        companyName={tallyCompany}
        storeName={storeName}
        onOpenCompanyModal={() => setShowCompanyModal(true)}
        onToggleBridgeConnection={handleToggleBridgeConnection}
        onPingBridge={handlePingBridge}
        onPushToTally={handlePushToTally}
        onOpenBankImport={() => setActiveTab('bank-statement')}
        onOpenAdminKeyGen={() => setAdminModalOpen(true)}
        isPushing={isPushing}
        billCount={bills.length}
        unsyncedCount={unsyncedCount}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-40 px-4 py-2.5 bg-slate-900 text-white text-xs font-semibold rounded-lg shadow-xl border border-slate-700 animate-fade-in"
        >
          {toastMessage}
        </div>
      )}

      {/* Main Container */}
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-3 sm:px-6 py-4 space-y-4">
        {activeTab === 'workbench' && (
          <>
            {/* Tally Offline Warning Card */}
            {!bridgeStatus.connected && (
              <div className="flex items-center justify-between p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-xs animate-in fade-in">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                  <div>
                    <span className="font-bold">Tally is Offline: </span>
                    <span className="text-slate-600">
                      Open your company in TallyPrime / Tally.ERP 9 (Port 9000) and run <code>tally-bridge.exe</code> to sync the live invoice number.
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleFetchInvoiceFromTally(false)}
                  disabled={isFetchingInvoice}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer shrink-0 ml-3"
                >
                  {isFetchingInvoice ? 'Connecting...' : 'Connect & Fetch Tally'}
                </button>
              </div>
            )}

            <BillingForm
              config={config}
              setConfig={setConfig}
              postLedgers={postLedgers}
              onAddPostLedger={addPostLedger}
              onRemovePostLedger={removePostLedger}
              salesLedgers={salesLedgers}
              onAddSalesLedger={addSalesLedger}
              onRemoveSalesLedger={removeSalesLedger}
              itemPresets={itemPresets}
              onAddItemPreset={addItemPreset}
              onRemoveItemPreset={removeItemPreset}
              onFetchInvoiceFromTally={() => handleFetchInvoiceFromTally(false)}
              isFetchingInvoice={isFetchingInvoice}
              onOpenBankImport={() => setActiveTab('bank-statement')}
              onGenerate={() => generateBills()}
              onPushToTally={handlePushToTally}
              onReset={resetAll}
              onExportXml={handleExportXml}
              onExportMastersXml={handleExportMastersXml}
              onExportExcel={handleExportExcel}
              onOpenXmlInspector={() => setActiveTab('sync-logs')}
              onSelectPreset={applyStockPreset}
              error={error}
              lastGeneratedAt={lastGeneratedAt}
              isPushing={isPushing}
              billCount={bills.length}
              bridgeConnected={bridgeStatus.connected}
            />

            <BillGrid
              bills={bills}
              config={config}
              summary={summary}
              onUpdateRow={updateBillRow}
              onDeleteRow={deleteBillRow}
              onReconcileDelta={reconcileWeightDelta}
              onGenerate={() => generateBills()}
            />
          </>
        )}

        {activeTab === 'bank-statement' && (
          <BankStatementManager
            bridgeStatus={bridgeStatus}
          />
        )}

        {activeTab === 'stock-ledgers' && (
          <StockAndLedgersView
            stockMap={stockMap}
            setStockMap={setStockMap}
            itemPresets={itemPresets}
            onAddItemPreset={addItemPreset}
            onRemoveItemPreset={removeItemPreset}
            postLedgers={postLedgers}
            onAddPostLedger={addPostLedger}
            onRemovePostLedger={removePostLedger}
            salesLedgers={salesLedgers}
            onAddSalesLedger={addSalesLedger}
            onRemoveSalesLedger={removeSalesLedger}
            bridgeStatus={bridgeStatus}
            setBridgeStatus={setBridgeStatus}
            onBackToWorkbench={() => setActiveTab('workbench')}
          />
        )}

        {activeTab === 'sync-logs' && (
          <SyncLogsView
            logs={syncLogs}
            onClearLogs={() => setSyncLogs([])}
            onPushToTally={handlePushToTally}
            onBackToWorkbench={() => setActiveTab('workbench')}
          />
        )}
      </main>

      {/* Admin Key Generator Modal */}
      <AdminKeyGenerator
        isOpen={adminModalOpen}
        onClose={() => setAdminModalOpen(false)}
      />

      {/* Tally Company Setup & Edit Profile Modal */}
      <CompanyProfileModal
        currentState={tallyState}
        currentProfile={tallyProfile}
        currentUnit={tallyUnit}
        isOpen={showCompanyModal}
        onClose={() => setShowCompanyModal(false)}
        currentCompany={tallyCompany}
        currentStoreName={storeName}
        onSave={handleSaveCompanyProfile}
        currentLicenseKey={licenseKey}
        currentEduMode={eduMode}
        isFirstTime={!localStorage.getItem('atits_company_configured')}
      />

      {/* Bank Statement Modal */}
      <BankStatementModal
        isOpen={bankModalOpen}
        onClose={() => setBankModalOpen(false)}
        bridgeStatus={bridgeStatus}
      />

      {/* Tally Sync Drawer with 2-Step Pipeline */}
      <TallySyncDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        bridgeStatus={bridgeStatus}
        logs={syncLogs}
        isPushing={isPushing}
        progress={syncProgress}
        xmlPayload={xmlPayload}
        mastersXmlPayload={mastersXmlPayload}
        onDispatchAgain={handlePushToTally}
        onDownloadXml={handleExportXml}
        onDownloadMastersXml={handleExportMastersXml}
        httpAttemptNotice={httpAttemptNotice}
      />
    </div>
  );
}
