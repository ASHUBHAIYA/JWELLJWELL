import React, { useState, useEffect } from 'react';
import { Building2, Store, Check, X, AlertCircle, KeyRound } from 'lucide-react';

interface CompanyProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentCompany: string;
  currentStoreName: string;
  onSave: (companyName: string, storeName: string, licenseKey: string, eduMode: boolean, stateName: string, profile: 'prime' | 'erp9', unit: string) => void;
  currentUnit?: string;
  currentState?: string;
  currentProfile?: 'prime' | 'erp9';
  currentLicenseKey?: string;
  currentEduMode?: boolean;
  isFirstTime?: boolean;
}

export const CompanyProfileModal: React.FC<CompanyProfileModalProps> = ({
  isOpen,
  onClose,
  currentCompany,
  currentStoreName,
  onSave,
  currentLicenseKey = '',
  currentEduMode = false,
  currentState = '',
  currentProfile = 'prime',
  currentUnit = 'GMS',
  isFirstTime = false,
}) => {
  const [companyInput, setCompanyInput] = useState(currentCompany || '');
  const [storeInput, setStoreInput] = useState(currentStoreName || '');
  const [licenseInput, setLicenseInput] = useState(currentLicenseKey);
  const [eduInput, setEduInput] = useState(currentEduMode);
  const [stateInput, setStateInput] = useState(currentState);
  const [unitInput, setUnitInput] = useState(currentUnit);
  const [profileInput, setProfileInput] = useState<'prime' | 'erp9'>(currentProfile);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCompanyInput(currentCompany || '');
      setStoreInput(currentStoreName || '');
      setLicenseInput(currentLicenseKey);
      setEduInput(currentEduMode);
      setStateInput(currentState);
      setProfileInput(currentProfile);
      setUnitInput(currentUnit);
      setError(null);
    }
  }, [isOpen, currentCompany, currentStoreName, currentLicenseKey, currentEduMode, currentState, currentProfile, currentUnit]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanComp = companyInput.trim();
    const cleanStore = storeInput.trim();

    if (!cleanComp) {
      setError('Tally Company Name is required.');
      return;
    }

    if (!stateInput.trim()) {
      setError('State is required for GST (exactly as named in Tally, e.g. the state in your company address).');
      return;
    }

    const cleanKey = licenseInput.trim().toUpperCase();
    if (cleanKey && !/^JWEL-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(cleanKey)) {
      setError('License key format should be JWEL-XXXX-XXXX-XXXX.');
      return;
    }

    onSave(cleanComp, cleanStore || cleanComp, cleanKey, eduInput, stateInput.trim(), profileInput, unitInput.trim() || 'GMS');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-slate-900 text-slate-100 rounded-2xl border border-slate-700 shadow-2xl max-w-md w-full p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
            <Building2 className="w-5 h-5" />
            <span>{isFirstTime ? 'Setup Tally Company & Store' : 'Edit Active Tally Company'}</span>
          </div>
          {!isFirstTime && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          {isFirstTime
            ? 'Please enter the exact Company Name currently open in your Tally Prime. This will be remembered across sessions.'
            : 'Update your active Tally Company Name and Jeweller Store Name. Changes apply across the entire application immediately.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-amber-400" />
              <span>Active Company Name in Tally *</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              value={companyInput}
              onChange={(e) => setCompanyInput(e.target.value)}
              placeholder="Exactly as shown in Tally"
              className="w-full h-10 px-3 text-xs font-mono bg-slate-950 border border-slate-700 rounded-lg text-amber-300 focus:outline-none focus:border-amber-400"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">
              Must match the company opened in your Tally Prime.
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5 text-amber-400" />
              <span>Jeweller / Store Trade Name</span>
            </label>
            <input
              type="text"
              value={storeInput}
              onChange={(e) => setStoreInput(e.target.value)}
              placeholder="Your store name"
              className="w-full h-10 px-3 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-amber-400" />
              <span>State (place of supply, exactly as in Tally)</span>
            </label>
            <input
              type="text"
              value={stateInput}
              onChange={(e) => setStateInput(e.target.value)}
              placeholder="State name as shown in Tally"
              className="w-full h-10 px-3 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-amber-400" />
              <span>Tally Software Version</span>
            </label>
            <select
              value={profileInput}
              onChange={(e) => setProfileInput(e.target.value as 'prime' | 'erp9')}
              className="w-full h-10 px-3 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-amber-400"
            >
              <option value="prime">TallyPrime (any release, including 7.x)</option>
              <option value="erp9">Tally.ERP 9 (Release 6.0 or later, needed for GST)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-amber-400" />
              <span>Unit symbol for grams (as used in Tally)</span>
            </label>
            <input
              type="text"
              value={unitInput}
              onChange={(e) => setUnitInput(e.target.value)}
              placeholder="Unit already in your Tally for grams"
              className="w-full h-10 px-3 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-amber-400" />
              <span>License Key (same key used in tally-bridge.exe)</span>
            </label>
            <input
              type="text"
              value={licenseInput}
              onChange={(e) => setLicenseInput(e.target.value)}
              placeholder="JWEL-XXXX-XXXX-XXXX"
              className="w-full h-10 px-3 text-xs font-mono bg-slate-950 border border-slate-700 rounded-lg text-amber-300 focus:outline-none focus:border-amber-400"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">
              Links this browser (PC or phone) to your shop PC's bridge.
            </span>
          </div>

          <label className="flex items-start gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={eduInput}
              onChange={(e) => setEduInput(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Tally Educational mode — moves voucher dates to the 1st / 2nd / last day of the month so test imports
              are accepted. Turn OFF for licensed Tally.
            </span>
          </label>

          {error && (
            <div className="flex items-center gap-1.5 text-xs text-rose-400 font-medium bg-rose-950/40 p-2 rounded-lg border border-rose-900/60">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            {!isFirstTime && (
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              className="flex-1 sm:flex-initial px-5 py-2 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-md shadow-amber-400/20"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Save &amp; Apply Company</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
