import React from 'react';
import { X, Landmark } from 'lucide-react';
import { BridgeStatus } from '../types';
import { BankStatementManager } from './BankStatementManager';

interface BankStatementModalProps {
  isOpen: boolean;
  onClose: () => void;
  bridgeStatus: BridgeStatus;
}

export const BankStatementModal: React.FC<BankStatementModalProps> = ({
  isOpen,
  onClose,
  bridgeStatus,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Direct Bank Statement to Tally Uploader Modal"
    >
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-5xl w-full flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-900 text-white border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-400/20 text-emerald-400 rounded-lg">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight">
                Bank Statement &rarr; Direct Tally Prime Bridge
              </h2>
              <p className="text-[11px] text-slate-400 font-mono">
                Upload bank Excel statement (.xlsx, .xls, .csv) &amp; sync 1:1 Receipt / Payment vouchers directly to Tally Prime
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 bg-slate-100">
          <BankStatementManager
            bridgeStatus={bridgeStatus}
            onCloseModal={onClose}
            isModal={true}
          />
        </div>
      </div>
    </div>
  );
};
