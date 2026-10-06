import React, { useState } from 'react';
import {
  KeyRound,
  ShieldCheck,
  Copy,
  Check,
  Sparkles,
  Store,
  Phone,
  Trash2,
  X,
  Share2,
  Lock,
  RefreshCw,
} from 'lucide-react';
import { LicenseKeyRecord } from '../types';
import {
  saveAdminPinToCloudflareKV,
  createLicenseKeyInCloudflareKV,
} from '../utils/adminAuth';

interface AdminKeyGeneratorProps {
  isOpen: boolean;
  onClose: () => void;
}

export function generateCryptoLicenseKey(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // base32 avoiding ambiguous 0/O, 1/I
  const randomChunk = (len: number) => {
    let res = '';
    const array = new Uint8Array(len);
    window.crypto.getRandomValues(array);
    for (let i = 0; i < len; i++) {
      res += chars[array[i] % chars.length];
    }
    return res;
  };

  return `JWEL-${randomChunk(4)}-${randomChunk(4)}-${randomChunk(4)}`;
}

export const AdminKeyGenerator: React.FC<AdminKeyGeneratorProps> = ({ isOpen, onClose }) => {
  const [storeName, setStoreName] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [durationMonths, setDurationMonths] = useState<number>(12); // Standard: 1-Year
  const [isLoading, setIsLoading] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<LicenseKeyRecord | null>(null);
  const [copied, setCopied] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const [showChangePin, setShowChangePin] = useState(false);
  const [newPinInput, setNewPinInput] = useState('');
  const [confirmNewPinInput, setConfirmNewPinInput] = useState('');
  const [isUpdatingPin, setIsUpdatingPin] = useState(false);
  const [pinChangeError, setPinChangeError] = useState<string | null>(null);
  const [pinChangeSuccess, setPinChangeSuccess] = useState<string | null>(null);

  // Active Session License History
  const [sessionKeys, setSessionKeys] = useState<LicenseKeyRecord[]>([]);

  if (!isOpen) return null;

  const handleGenerateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeName.trim()) return;

    setIsLoading(true);
    setStatusNotice(null);

    const createdDate = new Date();
    const expiryDate = new Date(createdDate);
    expiryDate.setMonth(expiryDate.getMonth() + durationMonths);

    const formattedCreated = createdDate.toISOString().split('T')[0];
    const formattedExpiry = expiryDate.toISOString().split('T')[0];

    // Calls Cloudflare Worker to create and store key in D1 SQL Database
    const result = await createLicenseKeyInCloudflareKV({
      storeName: storeName.trim(),
      contactInfo: contactInfo.trim(),
      durationMonths,
    });

    const finalLicenseKey = result.licenseKey || generateCryptoLicenseKey();
    setStatusNotice(result.message || 'Saved to Cloudflare D1 Database');

    const newRecord: LicenseKeyRecord = {
      id: `lic-${Date.now()}`,
      licenseKey: finalLicenseKey,
      storeName: storeName.trim(),
      contactInfo: contactInfo.trim(),
      durationMonths,
      createdAt: formattedCreated,
      expiresAt: formattedExpiry,
      status: 'active',
      generatedBy: 'Admin (Cloudflare D1 SQL)',
    };

    setGeneratedKey(newRecord);
    setSessionKeys((prev) => [newRecord, ...prev]);
    setIsLoading(false);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUpdateStoredPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinChangeError(null);
    setPinChangeSuccess(null);

    const trimmed = newPinInput.trim();
    if (trimmed.length < 4) {
      setPinChangeError('PIN must be at least 4 characters/digits.');
      return;
    }
    if (trimmed !== confirmNewPinInput.trim()) {
      setPinChangeError('PIN confirmation does not match.');
      return;
    }

    setIsUpdatingPin(true);
    const res = await saveAdminPinToCloudflareKV(trimmed);
    setIsUpdatingPin(false);

    if (res.success) {
      setPinChangeSuccess(res.message);
      setTimeout(() => {
        setShowChangePin(false);
        setNewPinInput('');
        setConfirmNewPinInput('');
        setPinChangeSuccess(null);
      }, 1800);
    } else {
      setPinChangeError(res.message);
    }
  };

  const getWhatsAppShareUrl = (record: LicenseKeyRecord) => {
    const text = `*ATITS Split ERP — License Activation Key* 💎\n\n*Store Name:* ${record.storeName}\n*License Key:* \`${record.licenseKey}\`\n*Validity:* ${record.durationMonths === 12 ? '1 Year' : `${record.durationMonths} Months`} (Expires: ${record.expiresAt})\n*Tally Service:* tally-bridge.exe (connects securely via cloud, works from PC and mobile)\n\n*Quick Instructions:*\n1. Run \`tally-bridge.exe\` on the shop PC and enter this License Key.\n2. Open Tally with your company loaded.\n3. In the web app: Company Settings → paste the same License Key.\n\n_Support: ATITS ERP Tech Support_`;
    
    const cleanPhone = record.contactInfo.replace(/[^0-9]/g, '');
    const phoneParam = cleanPhone.length >= 10 ? `phone=${cleanPhone}&` : '';
    return `https://api.whatsapp.com/send?${phoneParam}text=${encodeURIComponent(text)}`;
  };

  const handleDeleteRecord = (id: string) => {
    setSessionKeys((prev) => prev.filter((k) => k.id !== id));
    if (generatedKey?.id === id) setGeneratedKey(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label="Admin License Key Generator Modal"
    >
      <div className="bg-slate-900 text-slate-100 rounded-2xl border border-slate-700 shadow-2xl max-w-2xl w-full flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-400/10 text-amber-400 rounded-lg border border-amber-400/20">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                  License Management Console
                </h2>
              </div>
              <p className="text-xs text-slate-400">
                Generate &amp; manage 1-year cryptographic licenses for stores.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setShowChangePin((prev) => !prev);
                setPinChangeError(null);
                setPinChangeSuccess(null);
              }}
              title="Change Master PIN"
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5 text-amber-400" />
              <span>Change PIN</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Change PIN Pop-down Box */}
        {showChangePin && (
          <form
            onSubmit={handleUpdateStoredPin}
            className="px-5 py-4 bg-slate-950 border-b border-amber-400/30 space-y-3 animate-in fade-in duration-150 text-xs"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-amber-300">
                <Lock className="w-4 h-4" />
                <span>Update Master Admin PIN</span>
              </div>
              <button
                type="button"
                onClick={() => setShowChangePin(false)}
                className="text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                Cancel
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  New Master PIN (min 4 digits) *
                </label>
                <input
                  type="password"
                  required
                  value={newPinInput}
                  onChange={(e) => setNewPinInput(e.target.value)}
                  placeholder="Enter new 4-digit PIN"
                  className="w-full h-8 px-2.5 text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Confirm New PIN *
                </label>
                <input
                  type="password"
                  required
                  value={confirmNewPinInput}
                  onChange={(e) => setConfirmNewPinInput(e.target.value)}
                  placeholder="Re-enter new PIN"
                  className="w-full h-8 px-2.5 text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-amber-400"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="submit"
                disabled={isUpdatingPin || !newPinInput.trim() || !confirmNewPinInput.trim()}
                className="px-4 py-1.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
              >
                {isUpdatingPin ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>{isUpdatingPin ? 'Saving...' : 'Save New PIN'}</span>
              </button>
            </div>

            {pinChangeError && (
              <div className="text-rose-400 text-xs font-medium">{pinChangeError}</div>
            )}
            {pinChangeSuccess && (
              <div className="text-emerald-400 text-xs font-medium">{pinChangeSuccess}</div>
            )}
          </form>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Key Creation Form */}
          <form onSubmit={handleGenerateKey} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div className="sm:col-span-1">
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Store / Jeweller Name *
                </label>
                <div className="relative">
                  <Store className="w-4 h-4 text-slate-500 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    required
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder="Store name"
                    className="w-full h-9 pl-9 pr-3 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div className="sm:col-span-1">
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Contact / WhatsApp (Optional)
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-500 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={contactInfo}
                    onChange={(e) => setContactInfo(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full h-9 pl-9 pr-3 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div className="sm:col-span-1">
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  License Validity
                </label>
                <select
                  value={durationMonths}
                  onChange={(e) => setDurationMonths(Number(e.target.value))}
                  className="w-full h-9 px-3 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-amber-400"
                >
                  <option value={12}>1 Year (Standard Bullion License)</option>
                  <option value={24}>2 Years</option>
                  <option value={36}>3 Years</option>
                  <option value={6}>6 Months</option>
                  <option value={1}>1 Month (Trial)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isLoading || !storeName.trim()}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 rounded-lg transition-colors cursor-pointer shadow-lg shadow-amber-400/20"
              >
                {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span>Issue &amp; Activate License Key</span>
              </button>
            </div>
          </form>

          {statusNotice && (
            <div className="p-2.5 bg-slate-950/80 border border-slate-800 rounded-lg text-xs text-amber-300 font-mono flex items-center gap-2">
              <Sparkles className="w-4 h-4 shrink-0 text-amber-400" />
              <span>{statusNotice}</span>
            </div>
          )}

          {/* Newly Issued License Banner */}
          {generatedKey && (
            <div className="p-4 bg-gradient-to-r from-amber-400/10 via-slate-950 to-slate-950 border-2 border-amber-400/40 rounded-xl space-y-3 animate-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  Newly Issued 1-Year License Key
                </span>
                <span className="text-[11px] font-mono text-slate-400">
                  Expires: {generatedKey.expiresAt}
                </span>
              </div>

              <div className="flex items-center gap-2 bg-slate-950 p-2.5 rounded-lg border border-amber-400/30">
                <span className="font-mono text-base sm:text-lg font-extrabold text-amber-300 tracking-wider flex-1 select-all">
                  {generatedKey.licenseKey}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(generatedKey.licenseKey)}
                  className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold rounded flex items-center gap-1 cursor-pointer transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy Key'}</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                <span className="text-slate-400">
                  Store: <strong className="text-white">{generatedKey.storeName}</strong>
                </span>
                <div className="flex items-center gap-2">
                  <a
                    href={getWhatsAppShareUrl(generatedKey)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/20 border border-emerald-400/30 rounded-lg transition-colors cursor-pointer"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Share on WhatsApp</span>
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Session License Keys Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Issued Licenses ({sessionKeys.length})
              </h3>
            </div>

            <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-900 text-slate-400 border-b border-slate-800 text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3">License Key</th>
                    <th className="py-2.5 px-3">Store Name</th>
                    <th className="py-2.5 px-3">Validity</th>
                    <th className="py-2.5 px-3">Expires At</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 font-mono">
                  {sessionKeys.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-500 font-sans">
                        No license keys issued in this session yet. Fill the form above to issue a 1-year cryptographic key.
                      </td>
                    </tr>
                  ) : (
                    sessionKeys.map((k) => (
                      <tr key={k.id} className="hover:bg-slate-900/50">
                        <td className="py-2.5 px-3 font-bold text-amber-300">
                          {k.licenseKey}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300 font-sans">
                          {k.storeName}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400">
                          {k.durationMonths} Months
                        </td>
                        <td className="py-2.5 px-3 text-slate-400">
                          {k.expiresAt}
                        </td>
                        <td className="py-2.5 px-3 text-right font-sans">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleCopy(k.licenseKey)}
                              title="Copy License Key"
                              className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <a
                              href={getWhatsAppShareUrl(k)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Send to Jeweller on WhatsApp"
                              className="p-1 text-emerald-400 hover:text-emerald-300 rounded hover:bg-emerald-950/40 cursor-pointer"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </a>
                            <button
                              type="button"
                              onClick={() => handleDeleteRecord(k.id)}
                              title="Remove from session list"
                              className="p-1 text-slate-500 hover:text-rose-400 rounded hover:bg-slate-800 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-end text-xs text-slate-500">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
