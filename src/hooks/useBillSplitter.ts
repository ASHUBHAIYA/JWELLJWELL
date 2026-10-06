import { useState, useMemo, useCallback, useEffect } from 'react';
import { SplitBill, SplitConfig, SplitSummary, StockItemPreset } from '../types';

export const INITIAL_POST_LEDGERS: string[] = []; // added by the user in the UI

export const INITIAL_SALES_LEDGERS: string[] = []; // added by the user in the UI

export const INITIAL_STOCK_ITEM_PRESETS: StockItemPreset[] = []; // added by the user in the UI

export const DEFAULT_SPLIT_CONFIG: SplitConfig = {
  postAccountName: '',
  itemName: '',
  itemSalesAccount: '',
  billDate: new Date().toISOString().split('T')[0],
  minBillLimit: 35000,
  maxBillLimit: 48500,
  minRate: 7540,
  maxRate: 7685,
  gstRate: 3,
  totalWeight: 55.0, // in grams (g)
  voucherPrefix: '', // fetched from Tally or typed in the UI
  startingBillNo: 1,
  unitLabel: 'g', // Default strictly in grams
};

const MAX_SUPPORTED_INVOICES = 5000;

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

function round3(val: number): number {
  return Math.round((val + Number.EPSILON) * 1000) / 1000;
}

export function calculateBillAmounts(weight: number, rate: number, gstRate: number) {
  const cleanWeight = round3(weight);
  const cleanRate = round2(rate);
  const grossAmount = round2(cleanWeight * cleanRate);
  const gstAmount = round2(grossAmount * (gstRate / 100));
  const netAmount = round2(grossAmount + gstAmount);
  const finalBillAmount = Math.round(netAmount);
  const roundOff = round2(finalBillAmount - netAmount);

  return {
    weight: cleanWeight,
    rate: cleanRate,
    grossAmount,
    gstRate: round2(gstRate),
    gstAmount,
    netAmount,
    roundOff,
    finalBillAmount,
  };
}

function getMaxTicksForRate(rate: number, gstRate: number, maxBillLimit: number): number {
  if (rate <= 0 || maxBillLimit <= 0) return 0;
  const taxMultiplier = 1 + gstRate / 100;
  let ticks = Math.floor((maxBillLimit * 1000) / (rate * taxMultiplier));

  while (ticks > 0) {
    const w = ticks / 1000;
    const calc = calculateBillAmounts(w, rate, gstRate);
    if (calc.netAmount <= maxBillLimit && calc.finalBillAmount <= maxBillLimit) {
      return ticks;
    }
    ticks--;
  }
  return 0;
}

function getMinTicksForRate(rate: number, gstRate: number, minBillLimit: number): number {
  if (rate <= 0 || minBillLimit <= 0) return 1;
  const taxMultiplier = 1 + gstRate / 100;
  let ticks = Math.ceil((minBillLimit * 1000) / (rate * taxMultiplier));

  while (ticks > 1) {
    const w = (ticks - 1) / 1000;
    const calc = calculateBillAmounts(w, rate, gstRate);
    if (calc.netAmount >= minBillLimit && calc.finalBillAmount >= minBillLimit) {
      ticks--;
    } else {
      break;
    }
  }
  return Math.max(1, ticks);
}

function generateOrganicRates(count: number, minRate: number, maxRate: number): number[] {
  const low = Math.min(minRate, maxRate);
  const high = Math.max(minRate, maxRate);
  const span = high - low;

  if (span < 0.01) {
    return Array.from({ length: count }, () => round2(low));
  }

  const rates: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    // Generate evenly spread rates with natural jitter across the entire span
    const ratio = count === 1 ? 0.5 : i / (count - 1);
    const jitter = (Math.random() - 0.5) * (span > 50 ? 0.25 : 0.15);
    const clampedRatio = Math.max(0, Math.min(1, ratio + jitter));
    const raw = low + span * clampedRatio;

    let formatted: number;
    if (span >= 100) {
      const step = 1;
      formatted = Math.round(raw / step) * step;
    } else {
      formatted = round2(raw);
    }

    rates[i] = Math.max(low, Math.min(high, round2(formatted)));
  }

  // Shuffle to randomize ordering across invoices
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = rates[i];
    rates[i] = rates[j];
    rates[j] = tmp;
  }

  return rates;
}

export function runBillSplittingAlgorithm(config: SplitConfig): {
  bills: SplitBill[];
  error: string | null;
} {
  const {
    totalWeight,
    minRate: rawMinRate,
    maxRate: rawMaxRate,
    gstRate,
    minBillLimit: rawMinBillLimit,
    maxBillLimit: rawMaxBillLimit,
    postAccountName,
    itemName,
    itemSalesAccount,
    billDate,
    voucherPrefix,
    startingBillNo,
  } = config;

  const totalTicks = Math.round(totalWeight * 1000);
  if (totalTicks <= 0) {
    return { bills: [], error: 'Total Weight must be greater than 0.000 g.' };
  }

  const minRate = Math.min(Math.max(0.01, rawMinRate || 1), Math.max(0.01, rawMaxRate || 1));
  const maxRate = Math.max(Math.max(0.01, rawMinRate || 1), Math.max(0.01, rawMaxRate || 1));

  let maxBillLimit = Math.max(100, rawMaxBillLimit || 48500);
  let minBillLimit = Math.max(0, rawMinBillLimit || 0);

  if (minBillLimit > maxBillLimit) {
    const tmp = minBillLimit;
    minBillLimit = maxBillLimit;
    maxBillLimit = tmp;
  }

  const minCapAtMaxRate = getMaxTicksForRate(maxRate, gstRate, maxBillLimit);
  const minCapAtMinRate = getMaxTicksForRate(minRate, gstRate, maxBillLimit);

  if (minCapAtMinRate < 1) {
    const minNeededLimit = Math.ceil(0.001 * minRate * (1 + gstRate / 100));
    return {
      bills: [],
      error: `Max Bill Limit (₹${maxBillLimit.toLocaleString('en-IN')}) is too low to accommodate even 0.001 ${config.unitLabel || 'g'} at Min Rate ₹${minRate.toLocaleString('en-IN')}. Minimum required limit is ₹${minNeededLimit.toLocaleString('en-IN')}.`,
    };
  }

  const midRate = (minRate + maxRate) / 2;
  const midCap = Math.max(1, getMaxTicksForRate(midRate, gstRate, maxBillLimit));
  
  // Use average target in the middle of min and max limit so we have maximum headroom for big differences
  const idealFloor = minBillLimit > 0
    ? getMinTicksForRate(midRate, gstRate, minBillLimit)
    : Math.max(1, Math.floor(midCap * 0.4));
  const idealTarget = Math.max(1, Math.min(midCap, Math.floor((idealFloor + midCap) / 2)));

  let estimatedCount = Math.max(1, Math.ceil(totalTicks / idealTarget));
  if (estimatedCount > totalTicks) {
    estimatedCount = totalTicks;
  }

  if (totalTicks / Math.max(1, minCapAtMinRate) > MAX_SUPPORTED_INVOICES) {
    return {
      bills: [],
      error: `Splitting ${totalWeight.toLocaleString('en-IN', { minimumFractionDigits: 3 })} ${config.unitLabel || 'g'} under ₹${maxBillLimit.toLocaleString('en-IN')} requires over ${MAX_SUPPORTED_INVOICES.toLocaleString('en-IN')} invoices. Please increase Max Bill Limit or reduce Total Weight.`,
    };
  }

  if (estimatedCount > MAX_SUPPORTED_INVOICES) {
    estimatedCount = MAX_SUPPORTED_INVOICES;
  }

  let rates = generateOrganicRates(estimatedCount, minRate, maxRate);
  let maxCapacities = rates.map((r) => getMaxTicksForRate(r, gstRate, maxBillLimit));
  let minCapacities = rates.map((r) => (minBillLimit > 0 ? Math.min(maxCapacities[0], getMinTicksForRate(r, gstRate, minBillLimit)) : 1));

  for (let i = 0; i < rates.length; i++) {
    if (maxCapacities[i] < 1) {
      rates[i] = minRate;
      maxCapacities[i] = minCapAtMinRate;
      minCapacities[i] = minBillLimit > 0 ? getMinTicksForRate(minRate, gstRate, minBillLimit) : 1;
    }
  }

  let totalMaxCapacity = maxCapacities.reduce((acc, c) => acc + c, 0);

  while (totalMaxCapacity < totalTicks && rates.length < MAX_SUPPORTED_INVOICES && rates.length < totalTicks) {
    const extraRate = generateOrganicRates(1, minRate, maxRate)[0];
    const extraMax = getMaxTicksForRate(extraRate, gstRate, maxBillLimit);
    const validRate = extraMax >= 1 ? extraRate : minRate;
    const validMax = extraMax >= 1 ? extraMax : minCapAtMinRate;
    const validMin = minBillLimit > 0 ? getMinTicksForRate(validRate, gstRate, minBillLimit) : 1;
    rates.push(validRate);
    maxCapacities.push(validMax);
    minCapacities.push(Math.min(validMax, validMin));
    totalMaxCapacity += validMax;
  }

  const billCount = rates.length;

  // WIDE SPREAD GENERATOR: Distribute targets across the FULL spectrum of [minBillLimit, maxBillLimit]
  // This produces big, realistic differences (₹35,000, ₹47,000, ₹38,000, ₹44,000, ₹48,200)
  const ticks: number[] = new Array(billCount);
  const rawTargets: number[] = new Array(billCount);
  let rawSum = 0;

  for (let i = 0; i < billCount; i++) {
    const minC = minCapacities[i];
    const maxC = maxCapacities[i];
    const spanC = Math.max(0, maxC - minC);

    // Use a diverse distribution pattern (low, high, mid-low, mid-high) to guarantee large value differences
    const patternType = i % 4;
    let factor: number;
    if (patternType === 0) {
      // Near min limit (e.g. ₹35,000 - ₹37,000)
      factor = 0.05 + 0.25 * Math.random();
    } else if (patternType === 1) {
      // Near max limit (e.g. ₹46,000 - ₹48,400)
      factor = 0.75 + 0.23 * Math.random();
    } else if (patternType === 2) {
      // Mid-high (e.g. ₹42,000 - ₹45,000)
      factor = 0.50 + 0.25 * Math.random();
    } else {
      // Mid-low (e.g. ₹38,000 - ₹41,000)
      factor = 0.25 + 0.25 * Math.random();
    }

    const rw = minC + spanC * factor;
    rawTargets[i] = rw;
    rawSum += rw;
  }

  let currentSum = 0;
  for (let i = 0; i < billCount; i++) {
    const minC = minCapacities[i];
    const maxC = maxCapacities[i];
    const scaled = Math.round((rawTargets[i] / (rawSum || 1)) * totalTicks);
    const val = Math.max(minC, Math.min(maxC, scaled));
    ticks[i] = val;
    currentSum += val;
  }

  let diff = totalTicks - currentSum;
  let guard = 0;

  // Distribute difference while maintaining maximum variety
  while (diff !== 0 && guard < 50000) {
    guard++;
    if (diff > 0) {
      // Pick random eligible bills with headroom to add
      let changed = false;
      const order = Array.from({ length: billCount }, (_, idx) => idx).sort(() => Math.random() - 0.5);
      for (const idx of order) {
        if (diff <= 0) break;
        const headroom = maxCapacities[idx] - ticks[idx];
        if (headroom > 0) {
          const chunk = Math.min(diff, Math.max(1, Math.min(headroom, Math.ceil(diff / Math.max(1, Math.min(10, billCount))))));
          ticks[idx] += chunk;
          diff -= chunk;
          changed = true;
        }
      }
      if (!changed) break;
    } else {
      // Pick random eligible bills with floor headroom to subtract
      let changed = false;
      const order = Array.from({ length: billCount }, (_, idx) => idx).sort(() => Math.random() - 0.5);
      for (const idx of order) {
        if (diff >= 0) break;
        const minC = minCapacities[idx];
        const available = ticks[idx] - minC;
        if (available > 0) {
          const chunk = Math.min(-diff, Math.max(1, Math.min(available, Math.ceil(-diff / Math.max(1, Math.min(10, billCount))))));
          ticks[idx] -= chunk;
          diff += chunk;
          changed = true;
        }
      }
      if (!changed) {
        // If strict minCap prevented removing, relax to 1 tick
        for (let idx = billCount - 1; idx >= 0 && diff < 0; idx--) {
          const available = ticks[idx] - 1;
          if (available > 0) {
            const chunk = Math.min(-diff, available);
            ticks[idx] -= chunk;
            diff += chunk;
          }
        }
        break;
      }
    }
  }

  // Final exact tick balance guarantee
  let finalDelta = totalTicks - ticks.reduce((acc, t) => acc + t, 0);
  if (finalDelta !== 0) {
    for (let i = 0; i < billCount && finalDelta !== 0; i++) {
      if (finalDelta > 0 && ticks[i] + finalDelta <= maxCapacities[i]) {
        ticks[i] += finalDelta;
        finalDelta = 0;
        break;
      } else if (finalDelta < 0 && ticks[i] + finalDelta >= 1) {
        ticks[i] += finalDelta;
        finalDelta = 0;
        break;
      }
    }
    if (finalDelta !== 0 && ticks.length > 0) {
      ticks[ticks.length - 1] = Math.max(1, ticks[ticks.length - 1] + finalDelta);
    }
  }

  const bills: SplitBill[] = new Array(billCount);
  for (let idx = 0; idx < billCount; idx++) {
    const weight = ticks[idx] / 1000;
    const rate = rates[idx];
    const amounts = calculateBillAmounts(weight, rate, gstRate);
    const billNumber = idx + 1;
    const seqNo = startingBillNo + idx;

    bills[idx] = {
      id: `bill-${Date.now()}-${idx}`,
      billNumber,
      voucherNo: `${voucherPrefix}${seqNo}`,
      billDate,
      postAccountName,
      itemName,
      itemSalesAccount,
      ...amounts,
      syncStatus: 'idle',
    };
  }

  return { bills, error: null };
}

export function useBillSplitter() {
  const [postLedgers, setPostLedgers] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('bullionsplit_post_ledgers');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return INITIAL_POST_LEDGERS;
  });

  const [salesLedgers, setSalesLedgers] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('bullionsplit_sales_ledgers');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return INITIAL_SALES_LEDGERS;
  });

  const [itemPresets, setItemPresets] = useState<StockItemPreset[]>(() => {
    try {
      const saved = localStorage.getItem('bullionsplit_custom_items');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return INITIAL_STOCK_ITEM_PRESETS;
  });

  useEffect(() => {
    try {
      localStorage.setItem('bullionsplit_post_ledgers', JSON.stringify(postLedgers));
    } catch {}
  }, [postLedgers]);

  useEffect(() => {
    try {
      localStorage.setItem('bullionsplit_sales_ledgers', JSON.stringify(salesLedgers));
    } catch {}
  }, [salesLedgers]);

  useEffect(() => {
    try {
      localStorage.setItem('bullionsplit_custom_items', JSON.stringify(itemPresets));
    } catch {}
  }, [itemPresets]);

  const [config, setConfig] = useState<SplitConfig>(() => {
    const firstItem: StockItemPreset | undefined = itemPresets[0];
    return {
      ...DEFAULT_SPLIT_CONFIG,
      postAccountName: postLedgers[0] ?? '',
      itemName: firstItem?.name ?? '',
      itemSalesAccount: salesLedgers[0] ?? '',
      minBillLimit: firstItem?.defaultMinBillLimit ?? DEFAULT_SPLIT_CONFIG.minBillLimit,
      maxBillLimit: firstItem?.defaultMaxBillLimit ?? DEFAULT_SPLIT_CONFIG.maxBillLimit,
      minRate: firstItem?.defaultMinRate ?? DEFAULT_SPLIT_CONFIG.minRate,
      maxRate: firstItem?.defaultMaxRate ?? DEFAULT_SPLIT_CONFIG.maxRate,
      totalWeight: firstItem?.defaultTotalWeight ?? DEFAULT_SPLIT_CONFIG.totalWeight,
      unitLabel: 'g',
    };
  });

  const [stockMap, setStockMap] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const preset of itemPresets) {
      initial[preset.name] = preset.openingStock;
    }
    return initial;
  });

  const initialResult = useMemo(() => runBillSplittingAlgorithm(DEFAULT_SPLIT_CONFIG), []);
  const [bills, setBills] = useState<SplitBill[]>(initialResult.bills);
  const [error, setError] = useState<string | null>(initialResult.error);
  const [lastGeneratedAt, setLastGeneratedAt] = useState<string>(() =>
    new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );

  const addPostLedger = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPostLedgers((prev) => {
      const match = prev.find((l) => l.toLowerCase() === trimmed.toLowerCase());
      if (match) return prev;
      return [...prev, trimmed];
    });
    setConfig((prev) => ({ ...prev, postAccountName: trimmed }));
  }, []);

  const removePostLedger = useCallback((name: string) => {
    setPostLedgers((prev) => {
      const filtered = prev.filter((l) => l !== name);
      return filtered.length > 0 ? filtered : [name];
    });
  }, []);

  const addSalesLedger = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSalesLedgers((prev) => {
      const match = prev.find((l) => l.toLowerCase() === trimmed.toLowerCase());
      if (match) return prev;
      return [...prev, trimmed];
    });
    setConfig((prev) => ({ ...prev, itemSalesAccount: trimmed }));
  }, []);

  const removeSalesLedger = useCallback((name: string) => {
    setSalesLedgers((prev) => {
      const filtered = prev.filter((l) => l !== name);
      return filtered.length > 0 ? filtered : [name];
    });
  }, []);

  const addItemPreset = useCallback((preset: StockItemPreset) => {
    const cleanName = preset.name.trim();
    if (!cleanName) return;
    const cleanPreset: StockItemPreset = {
      ...preset,
      name: cleanName,
      unit: 'g',
    };
    setItemPresets((prev) => {
      const existsIdx = prev.findIndex((p) => p.name.toLowerCase() === cleanName.toLowerCase());
      if (existsIdx >= 0) {
        const next = [...prev];
        next[existsIdx] = cleanPreset;
        return next;
      }
      return [...prev, cleanPreset];
    });
    setStockMap((prev) => ({ ...prev, [cleanName]: cleanPreset.openingStock }));
    setConfig((prev) => ({
      ...prev,
      itemName: cleanName,
      unitLabel: 'g',
      minRate: cleanPreset.defaultMinRate || prev.minRate,
      maxRate: cleanPreset.defaultMaxRate || prev.maxRate,
      totalWeight: cleanPreset.defaultTotalWeight || prev.totalWeight,
      minBillLimit: cleanPreset.defaultMinBillLimit || prev.minBillLimit,
      maxBillLimit: cleanPreset.defaultMaxBillLimit || prev.maxBillLimit,
    }));
  }, []);

  const mergeTallyMasters = useCallback(
    (tallyMasters: {
      postLedgers?: string[];
      salesLedgers?: string[];
      stockItems?: { name: string; hsnCode?: string }[];
    }) => {
      if (tallyMasters.postLedgers && tallyMasters.postLedgers.length > 0) {
        setPostLedgers((prev) => {
          const map = new Map<string, string>();
          for (const item of tallyMasters.postLedgers!) {
            if (item.trim() && !map.has(item.trim().toLowerCase())) {
              map.set(item.trim().toLowerCase(), item.trim());
            }
          }
          for (const item of prev) {
            if (item.trim() && !map.has(item.trim().toLowerCase())) {
              map.set(item.trim().toLowerCase(), item.trim());
            }
          }
          return Array.from(map.values());
        });

        setConfig((prev) => {
          if (!prev.postAccountName || !tallyMasters.postLedgers!.some((l) => l.toLowerCase() === prev.postAccountName.toLowerCase())) {
            return { ...prev, postAccountName: tallyMasters.postLedgers![0] };
          }
          const exactMatch = tallyMasters.postLedgers!.find((l) => l.toLowerCase() === prev.postAccountName.toLowerCase());
          return exactMatch ? { ...prev, postAccountName: exactMatch } : prev;
        });
      }

      if (tallyMasters.salesLedgers && tallyMasters.salesLedgers.length > 0) {
        setSalesLedgers((prev) => {
          const map = new Map<string, string>();
          for (const item of tallyMasters.salesLedgers!) {
            if (item.trim() && !map.has(item.trim().toLowerCase())) {
              map.set(item.trim().toLowerCase(), item.trim());
            }
          }
          for (const item of prev) {
            if (item.trim() && !map.has(item.trim().toLowerCase())) {
              map.set(item.trim().toLowerCase(), item.trim());
            }
          }
          return Array.from(map.values());
        });

        setConfig((prev) => {
          if (!prev.itemSalesAccount || !tallyMasters.salesLedgers!.some((l) => l.toLowerCase() === prev.itemSalesAccount.toLowerCase())) {
            return { ...prev, itemSalesAccount: tallyMasters.salesLedgers![0] };
          }
          const exactMatch = tallyMasters.salesLedgers!.find((l) => l.toLowerCase() === prev.itemSalesAccount.toLowerCase());
          return exactMatch ? { ...prev, itemSalesAccount: exactMatch } : prev;
        });
      }

      if (tallyMasters.stockItems && tallyMasters.stockItems.length > 0) {
        setItemPresets((prev) => {
          const map = new Map<string, StockItemPreset>();
          for (const item of tallyMasters.stockItems!) {
            const cleanName = item.name.trim();
            if (!cleanName) continue;
            const existing = prev.find((p) => p.name.toLowerCase() === cleanName.toLowerCase());
            map.set(cleanName.toLowerCase(), {
              name: cleanName,
              hsnCode: item.hsnCode || existing?.hsnCode || '7108',
              unit: 'g',
              openingStock: existing?.openingStock ?? 500,
              defaultMinRate: existing?.defaultMinRate ?? 7500,
              defaultMaxRate: existing?.defaultMaxRate ?? 7650,
              defaultMinBillLimit: existing?.defaultMinBillLimit ?? 35000,
              defaultMaxBillLimit: existing?.defaultMaxBillLimit ?? 48500,
              defaultTotalWeight: existing?.defaultTotalWeight ?? 50,
              description: existing?.description || `Tally Stock Item (${cleanName})`,
            });
          }
          for (const p of prev) {
            if (!map.has(p.name.toLowerCase())) {
              map.set(p.name.toLowerCase(), p);
            }
          }
          return Array.from(map.values());
        });

        setConfig((prev) => {
          const firstStock = tallyMasters.stockItems![0]?.name;
          if (!prev.itemName || !tallyMasters.stockItems!.some((s) => s.name.toLowerCase() === prev.itemName.toLowerCase())) {
            return firstStock ? { ...prev, itemName: firstStock } : prev;
          }
          const exactMatch = tallyMasters.stockItems!.find((s) => s.name.toLowerCase() === prev.itemName.toLowerCase());
          return exactMatch ? { ...prev, itemName: exactMatch.name } : prev;
        });
      }
    },
    []
  );

  const removeItemPreset = useCallback((name: string) => {
    setItemPresets((prev) => {
      const filtered = prev.filter((p) => p.name !== name);
      return filtered.length > 0 ? filtered : prev;
    });
  }, []);

  const generateBills = useCallback(
    (overrideConfig?: SplitConfig) => {
      const activeConfig = overrideConfig ?? config;
      const result = runBillSplittingAlgorithm(activeConfig);
      setError(result.error);
      if (!result.error) {
        setBills(result.bills);
        setLastGeneratedAt(
          new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        );
      }
      return result;
    },
    [config]
  );

  const updateBillRow = useCallback(
    (id: string, newWeight: number, newRate: number) => {
      setBills((prev) =>
        prev.map((bill) => {
          if (bill.id !== id) return bill;
          const updatedAmounts = calculateBillAmounts(
            Math.max(0.001, newWeight),
            Math.max(1, newRate),
            config.gstRate
          );
          return {
            ...bill,
            ...updatedAmounts,
            syncStatus: 'idle',
          };
        })
      );
    },
    [config.gstRate]
  );

  const deleteBillRow = useCallback(
    (id: string) => {
      setBills((prev) =>
        prev
          .filter((b) => b.id !== id)
          .map((b, idx) => ({
            ...b,
            billNumber: idx + 1,
            voucherNo: `${config.voucherPrefix}${config.startingBillNo + idx}`,
          }))
      );
    },
    [config.voucherPrefix, config.startingBillNo]
  );

  const reconcileWeightDelta = useCallback(() => {
    const currentTicks = bills.reduce((acc, b) => acc + Math.round(b.weight * 1000), 0);
    const targetTicks = Math.round(config.totalWeight * 1000);
    const deltaTicks = targetTicks - currentTicks;

    if (deltaTicks === 0) return;

    if (deltaTicks > 0) {
      const subResult = runBillSplittingAlgorithm({
        ...config,
        totalWeight: deltaTicks / 1000,
        startingBillNo: config.startingBillNo + bills.length,
      });
      if (!subResult.error && subResult.bills.length > 0) {
        setBills((prev) => {
          const merged = [...prev, ...subResult.bills];
          return merged.map((b, idx) => ({
            ...b,
            billNumber: idx + 1,
            voucherNo: `${config.voucherPrefix}${config.startingBillNo + idx}`,
          }));
        });
        setError(null);
      }
    } else {
      let toRemove = -deltaTicks;
      const updated = [...bills];
      for (let i = updated.length - 1; i >= 0 && toRemove > 0; i--) {
        const rowTicks = Math.round(updated[i].weight * 1000);
        if (rowTicks <= toRemove) {
          toRemove -= rowTicks;
          updated.splice(i, 1);
        } else {
          const newWeight = (rowTicks - toRemove) / 1000;
          toRemove = 0;
          updated[i] = {
            ...updated[i],
            ...calculateBillAmounts(newWeight, updated[i].rate, config.gstRate),
          };
        }
      }
      setBills(
        updated.map((b, idx) => ({
          ...b,
          billNumber: idx + 1,
          voucherNo: `${config.voucherPrefix}${config.startingBillNo + idx}`,
        }))
      );
    }
  }, [bills, config]);

  const resetAll = useCallback(() => {
    const firstItem: StockItemPreset | undefined = itemPresets[0];
    const freshConfig: SplitConfig = {
      ...DEFAULT_SPLIT_CONFIG,
      postAccountName: postLedgers[0] ?? '',
      itemName: firstItem?.name ?? '',
      itemSalesAccount: salesLedgers[0] ?? '',
      minBillLimit: firstItem?.defaultMinBillLimit ?? DEFAULT_SPLIT_CONFIG.minBillLimit,
      maxBillLimit: firstItem?.defaultMaxBillLimit ?? DEFAULT_SPLIT_CONFIG.maxBillLimit,
      minRate: firstItem?.defaultMinRate ?? DEFAULT_SPLIT_CONFIG.minRate,
      maxRate: firstItem?.defaultMaxRate ?? DEFAULT_SPLIT_CONFIG.maxRate,
      totalWeight: firstItem?.defaultTotalWeight ?? DEFAULT_SPLIT_CONFIG.totalWeight,
      unitLabel: 'g',
    };
    setConfig(freshConfig);
    const fresh = runBillSplittingAlgorithm(freshConfig);
    setBills(fresh.bills);
    setError(null);
    setLastGeneratedAt(
      new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    );
  }, [itemPresets, postLedgers, salesLedgers]);

  const applyStockPreset = useCallback((preset: StockItemPreset) => {
    const nextConfig: SplitConfig = {
      ...config,
      itemName: preset.name,
      unitLabel: 'g',
      minRate: preset.defaultMinRate,
      maxRate: preset.defaultMaxRate,
      minBillLimit: preset.defaultMinBillLimit ?? 35000,
      maxBillLimit: preset.defaultMaxBillLimit ?? 48500,
      totalWeight: preset.defaultTotalWeight,
    };
    setConfig(nextConfig);
    const res = runBillSplittingAlgorithm(nextConfig);
    setError(res.error);
    if (!res.error) {
      setBills(res.bills);
      setLastGeneratedAt(
        new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
    }
  }, [config]);

  const summary: SplitSummary = useMemo(() => {
    const totalTicks = bills.reduce((acc, b) => acc + Math.round(b.weight * 1000), 0);
    const totalWeightGenerated = round3(totalTicks / 1000);
    const targetTicks = Math.round(config.totalWeight * 1000);
    const weightDelta = round3((totalTicks - targetTicks) / 1000);
    const isWeightMatched = totalTicks === targetTicks;

    const totalTaxableAmount = round2(bills.reduce((acc, b) => acc + b.grossAmount, 0));
    const totalGstCollected = round2(bills.reduce((acc, b) => acc + b.gstAmount, 0));
    const totalNetAmount = round2(bills.reduce((acc, b) => acc + b.netAmount, 0));
    const totalRoundOff = round2(bills.reduce((acc, b) => acc + b.roundOff, 0));
    const grandTotalBillAmount = bills.reduce((acc, b) => acc + b.finalBillAmount, 0);

    const averageRate =
      totalWeightGenerated > 0 ? round2(totalTaxableAmount / totalWeightGenerated) : 0;
    const maxSingleBillAmount =
      bills.length > 0 ? Math.max(...bills.map((b) => b.finalBillAmount)) : 0;
    const minSingleBillAmount =
      bills.length > 0 ? Math.min(...bills.map((b) => b.finalBillAmount)) : 0;

    const allWithinLimit = bills.every(
      (b) =>
        (config.minBillLimit <= 0 || b.finalBillAmount >= config.minBillLimit || b.billNumber === bills.length) &&
        b.finalBillAmount <= config.maxBillLimit
    );

    const openingStockBalance = stockMap[config.itemName] ?? 500.0;
    const closingStockBalance = round3(openingStockBalance - totalWeightGenerated);

    return {
      billCount: bills.length,
      totalWeightGenerated,
      targetWeight: round3(config.totalWeight),
      weightDelta,
      isWeightMatched,
      totalTaxableAmount,
      totalGstCollected,
      totalNetAmount,
      totalRoundOff,
      grandTotalBillAmount,
      averageRate,
      minSingleBillAmount,
      maxSingleBillAmount,
      allWithinLimit,
      openingStockBalance,
      closingStockBalance,
    };
  }, [bills, config.totalWeight, config.minBillLimit, config.maxBillLimit, config.itemName, stockMap]);

  return {
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
    mergeTallyMasters,
  };
}
