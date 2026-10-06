import { BankVoucherEntry } from '../types';

/**
 * Narration -> ledger mapping for bank statement rows.
 *
 * Two layers, both stored in the browser (localStorage):
 *  1. Keyword rules  - e.g. "charges" -> a bank-charges expense ledger, "BY CASH" -> Contra with Cash.
 *  2. Learned map    - when the user picks a party ledger for a row, the counterparty key of that
 *                      narration is remembered and applied to future imports automatically.
 */

export interface NarrationRule {
  id: string;
  /** Case-insensitive regex source matched against the narration. */
  pattern: string;
  /** Ledger to use as the counter ledger. */
  ledger: string;
  /** Tally parent group used if the ledger has to be auto-created. */
  group: string;
  /** Send as Contra voucher (bank <-> cash). */
  contra?: boolean;
}

const RULES_KEY = 'bullionsplit_narration_rules';
const LEARNED_KEY = 'bullionsplit_narration_learned';

/** Starting rules; fully editable by the user (stored under RULES_KEY). */
export const DEFAULT_RULES: NarrationRule[] = [
  { id: 'r-cash', pattern: '\\bby cash\\b|cash dep|\\bcdm\\b|cash wdl|cash withdrawal|\\batm\\b', ledger: 'Cash', group: 'Cash-in-hand', contra: true },
  { id: 'r-charges', pattern: '\\bcharges?\\b|\\bchgs?\\b|\\bsms alert|\\bamc\\b', ledger: 'Bank Charges', group: 'Indirect Expenses' },
];

export function loadRules(): NarrationRule[] {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return DEFAULT_RULES;
}

export function saveRules(rules: NarrationRule[]) {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch {}
}

const NOISE = new Set([
  'imps', 'impsar', 'impsab', 'neft', 'neftn', 'nefto', 'rtgs', 'upi', 'mobft', 'mand', 'ach', 'ecs', 'nach',
  'to', 'from', 'by', 'dr', 'cr', 'ref', 'trf', 'transfer', 'payment', 'pay', 'customer', 'the', 'and', 'a', 'c',
]);

/** Stable key for the counterparty in a narration: IMPSAB/50921.../TANISHKA1210/94249... -> "tanishka". */
export function narrationKey(narration: string): string {
  const words = narration
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 3 && !NOISE.has(w));
  return words.slice(0, 3).join(' ');
}

function loadLearned(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LEARNED_KEY);
    if (raw) return JSON.parse(raw) || {};
  } catch {}
  return {};
}

export function learnMapping(narration: string, ledger: string) {
  const key = narrationKey(narration);
  if (!key) return;
  const map = loadLearned();
  if (ledger.trim()) map[key] = ledger.trim();
  else delete map[key];
  try {
    localStorage.setItem(LEARNED_KEY, JSON.stringify(map));
  } catch {}
}

/** Apply keyword rules, then learned mappings (learned wins), to freshly parsed entries. */
export function applyNarrationMappings(entries: BankVoucherEntry[]): BankVoucherEntry[] {
  const rules = loadRules()
    .map((r) => {
      try {
        return { rule: r, re: new RegExp(r.pattern, 'i') };
      } catch {
        return null;
      }
    })
    .filter((x): x is { rule: NarrationRule; re: RegExp } => x !== null && !!x.rule.ledger.trim());
  const learned = loadLearned();

  return entries.map((e) => {
    let next = e;
    const hit = rules.find(({ re }) => re.test(e.narration));
    if (hit) {
      next = { ...next, partyLedger: hit.rule.ledger.trim(), isContra: !!hit.rule.contra };
    }
    const learnedLedger = learned[narrationKey(e.narration)];
    if (learnedLedger && !hit?.rule.contra) {
      next = { ...next, partyLedger: learnedLedger };
    }
    return next;
  });
}

/** Parent group to use if a ledger must be created in Tally. */
export function groupForLedger(ledger: string, isBank: boolean): string {
  if (isBank || /bank|od|occ|current\s*a\/?c/i.test(ledger)) return 'Bank Accounts';
  const hit = loadRules().find((r) => r.ledger.trim().toLowerCase() === ledger.trim().toLowerCase());
  if (hit) return hit.group;
  if (/^suspense/i.test(ledger)) return 'Suspense A/c';
  if (/^cash/i.test(ledger)) return 'Cash-in-hand';
  return 'Sundry Debtors';
}
