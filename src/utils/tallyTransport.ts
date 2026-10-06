/**
 * Single transport layer for talking to Tally.
 *
 *   Browser (PC or phone) -> Cloud relay (Cloudflare Worker + D1) -> tally-bridge.exe -> Tally :9000
 *
 * The relay is the only path by default, so desktop and mobile behave identically.
 * (Calling http://127.0.0.1:8080 from an https page is blocked by mixed-content /
 * private-network rules in most browsers, and a phone can never reach the PC's localhost.)
 */
import {
  checkCloudflareRelayDaemonOnline,
  pushVoucherViaCloudflareRelay,
  queryTallyViaCloudflareRelay,
} from './adminAuth';

export const LICENSE_STORAGE_KEY = 'atits_license_key';
export const EDU_MODE_STORAGE_KEY = 'atits_tally_edu';

export function getLicenseKey(): string {
  try {
    return (localStorage.getItem(LICENSE_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function saveLicenseKey(key: string): void {
  try {
    localStorage.setItem(LICENSE_STORAGE_KEY, key.trim().toUpperCase());
  } catch {}
}

export interface TallyResult {
  ok: boolean; // transport worked AND Tally reported no errors
  created: number;
  altered: number;
  errors: number;
  lineErrors: string[];
  message: string;
  raw: string;
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

const num = (xml: string, tag: string): number => {
  const m = xml.match(new RegExp(`<${tag}[^>]*>\\s*(\\d+)\\s*</${tag}>`, 'i'));
  return m ? parseInt(m[1], 10) : 0;
};

/** Parses a Tally import RESPONSE, surfacing every LINEERROR / EXCEPTION instead of only the first. */
export function parseTallyImportResponse(raw: string): TallyResult {
  const xml = raw || '';
  const created = num(xml, 'CREATED');
  const altered = num(xml, 'ALTERED');
  let errors = num(xml, 'ERRORS');
  const exceptions = num(xml, 'EXCEPTIONS');

  const lineErrors: string[] = [];
  const re = /<LINEERROR[^>]*>([\s\S]*?)<\/LINEERROR>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) lineErrors.push(decodeXml(m[1]));

  const lower = xml.toLowerCase();
  if (!xml.trim()) lineErrors.push('Empty response from Tally.');
  if (lower.includes('unknown request')) lineErrors.push('Tally: Unknown request (check XML / report name).');
  if (lower.includes('could not set') && lineErrors.length === 0)
    lineErrors.push('Tally could not open the company. Check the company name matches exactly and is open.');
  if (lineErrors.length > 0 && errors === 0) errors = lineErrors.length;

  const ok = !!xml.trim() && errors === 0 && exceptions === 0 && created + altered > 0;
  let message = `Created ${created}, Altered ${altered}, Errors ${errors}`;
  if (lineErrors.length) message += ` — ${lineErrors.slice(0, 3).join(' | ')}`;
  return { ok, created, altered, errors: errors + exceptions, lineErrors, message, raw: xml };
}

export interface LastVoucher {
  prefix: string;
  lastNumber: number;
  full: string;
}

/**
 * Collection export of Sales vouchers for the current financial year.
 * Filters by voucher type (the old "Voucher Register" query ignored it).
 */
export function buildLastSalesVoucherQuery(company: string, voucherType = 'Sales', now = new Date()): string {
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; // FY starts 1 April
  const from = `${fyStartYear}0401`;
  const to = `${fyStartYear + 1}0331`;
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<ENVELOPE>
 <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ATITSLastSalesVch</ID></HEADER>
 <BODY><DESC>
  <STATICVARIABLES>
   <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   <SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>
   <SVFROMDATE>${from}</SVFROMDATE>
   <SVTODATE>${to}</SVTODATE>
  </STATICVARIABLES>
  <TDL><TDLMESSAGE>
   <COLLECTION NAME="ATITSLastSalesVch" ISMODIFY="No">
    <TYPE>Voucher</TYPE>
    <FETCH>VoucherNumber, Date, VoucherTypeName</FETCH>
    <FILTER>ATITSIsSales</FILTER>
   </COLLECTION>
   <SYSTEM TYPE="Formulae" NAME="ATITSIsSales">$VoucherTypeName = "${esc(voucherType)}"</SYSTEM>
  </TDLMESSAGE></TDL>
 </DESC></BODY>
</ENVELOPE>`;
}

/** Picks the genuinely latest voucher (by date, then number) — not the first one in the response. */
export function parseLastSalesVoucher(raw: string): LastVoucher | null {
  const blocks = raw.match(/<VOUCHER[\s>][\s\S]*?<\/VOUCHER>/gi) || [];
  const items: { no: string; date: string }[] = [];
  for (const b of blocks) {
    const no = b.match(/<VOUCHERNUMBER[^>]*>([^<]*)<\/VOUCHERNUMBER>/i);
    const dt = b.match(/<DATE[^>]*>(\d{8})<\/DATE>/i);
    if (no && no[1].trim()) items.push({ no: decodeXml(no[1]), date: dt ? dt[1] : '00000000' });
  }
  if (items.length === 0) {
    // Fallback for flat responses
    const all = [...raw.matchAll(/<VOUCHERNUMBER[^>]*>([^<]*)<\/VOUCHERNUMBER>/gi)].map((x) => decodeXml(x[1]));
    all.forEach((no) => no && items.push({ no, date: '00000000' }));
  }
  const split = (no: string) => {
    const m = no.match(/^(.*?)(\d+)$/);
    return m ? { prefix: m[1], n: parseInt(m[2], 10) } : null;
  };
  const parsed = items
    .map((i) => ({ ...i, p: split(i.no) }))
    .filter((i): i is { no: string; date: string; p: { prefix: string; n: number } } => !!i.p);
  if (parsed.length === 0) return null;
  parsed.sort((a, b) => (a.date === b.date ? a.p.n - b.p.n : a.date.localeCompare(b.date)));
  const latest = parsed[parsed.length - 1];
  const sameSeries = parsed.filter((i) => i.p.prefix === latest.p.prefix);
  const maxN = Math.max(...sameSeries.map((i) => i.p.n));
  return { prefix: latest.p.prefix, lastNumber: maxN, full: `${latest.p.prefix}${maxN}` };
}

export async function isBridgeOnline(): Promise<boolean> {
  const key = getLicenseKey();
  if (!key) return false;
  const r = await checkCloudflareRelayDaemonOnline(key);
  return r.online;
}

/** Sends an import envelope to Tally via the relay and returns a normalised result. */
export async function importToTally(xml: string): Promise<TallyResult> {
  const key = getLicenseKey();
  if (!key) {
    return { ok: false, created: 0, altered: 0, errors: 1, lineErrors: [], raw: '', message: 'No license key set. Enter your license key in Company Settings.' };
  }
  const r = await pushVoucherViaCloudflareRelay(xml, key);
  if (r.tallyResponse) {
    const parsed = parseTallyImportResponse(r.tallyResponse);
    if (!r.success && parsed.ok) parsed.ok = false;
    if (!r.success && r.message && parsed.lineErrors.length === 0) parsed.message = r.message;
    return parsed;
  }
  return { ok: false, created: 0, altered: 0, errors: 1, lineErrors: [], raw: '', message: r.message };
}

export async function fetchLastSalesVoucher(company: string): Promise<{ voucher: LastVoucher | null; error?: string; company?: string }> {
  const key = getLicenseKey();
  if (!key) return { voucher: null, error: 'No license key set.' };
  const res = await queryTallyViaCloudflareRelay(buildLastSalesVoucherQuery(company), key);
  if (!res.success || !res.tallyResponse) return { voucher: null, error: res.error || 'No response from bridge' };
  const lower = res.tallyResponse.toLowerCase();
  if (lower.includes('could not set') || lower.includes('no company')) {
    return { voucher: null, error: `Tally could not open company "${company}". Open it in Tally and check the name.` };
  }
  return { voucher: parseLastSalesVoucher(res.tallyResponse) };
}

export async function fetchLastBankVoucher(
  company: string,
  voucherType: 'Receipt' | 'Payment' = 'Receipt'
): Promise<{ voucher: LastVoucher | null; error?: string }> {
  const key = getLicenseKey();
  if (!key) return { voucher: null, error: 'No license key set in Company Settings.' };
  if (!company?.trim()) return { voucher: null, error: 'No Tally company specified.' };

  const res = await queryTallyViaCloudflareRelay(buildLastSalesVoucherQuery(company, voucherType), key);
  if (!res.success || !res.tallyResponse) return { voucher: null, error: res.error || 'No response from bridge' };
  const lower = res.tallyResponse.toLowerCase();
  if (lower.includes('could not set') || lower.includes('no company')) {
    return { voucher: null, error: `Tally could not open company "${company}".` };
  }
  return { voucher: parseLastSalesVoucher(res.tallyResponse) };
}

export interface TallyLedgerItem {
  name: string;
  parent: string;
}

export function buildFetchLedgersQuery(company: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<ENVELOPE>
 <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ATITSLedgersCollection</ID></HEADER>
 <BODY><DESC>
  <STATICVARIABLES>
   <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   <SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>
  </STATICVARIABLES>
  <TDL><TDLMESSAGE>
   <COLLECTION NAME="ATITSLedgersCollection" ISMODIFY="No">
    <TYPE>Ledger</TYPE>
    <FETCH>Name, Parent</FETCH>
   </COLLECTION>
  </TDLMESSAGE></TDL>
 </DESC></BODY>
</ENVELOPE>`;
}

export function parseTallyLedgers(raw: string): TallyLedgerItem[] {
  const ledgers: TallyLedgerItem[] = [];
  const re = /<LEDGER[\s>][\s\S]*?<\/LEDGER>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const block = m[0];
    const nameMatch = block.match(/<NAME[^>]*>([^<]+)<\/NAME>/i) || block.match(/NAME="([^"]+)"/i);
    const parentMatch = block.match(/<PARENT[^>]*>([^<]+)<\/PARENT>/i);
    if (nameMatch && nameMatch[1].trim()) {
      ledgers.push({
        name: decodeXml(nameMatch[1].trim()),
        parent: parentMatch ? decodeXml(parentMatch[1].trim()) : '',
      });
    }
  }
  return ledgers;
}

export async function fetchTallyLedgers(company: string): Promise<{
  bankLedgers: string[];
  partyLedgers: string[];
  allLedgers: TallyLedgerItem[];
  error?: string;
}> {
  const key = getLicenseKey();
  if (!key) return { bankLedgers: [], partyLedgers: [], allLedgers: [], error: 'No license key set in Company Settings.' };
  if (!company?.trim()) return { bankLedgers: [], partyLedgers: [], allLedgers: [], error: 'No Tally company specified.' };

  const res = await queryTallyViaCloudflareRelay(buildFetchLedgersQuery(company), key);
  if (!res.success || !res.tallyResponse) {
    return { bankLedgers: [], partyLedgers: [], allLedgers: [], error: res.error || 'No response from bridge' };
  }
  const all = parseTallyLedgers(res.tallyResponse);
  const bankLedgers: string[] = [];
  const partyLedgers: string[] = [];

  for (const item of all) {
    const parentLower = item.parent.toLowerCase();
    if (
      parentLower.includes('bank') ||
      parentLower.includes('od') ||
      parentLower.includes('occ') ||
      /bank|hdfc|icici|sbi|axis|pnb|canara|kotak|bob|union|indusind/i.test(item.name)
    ) {
      bankLedgers.push(item.name);
    } else {
      partyLedgers.push(item.name);
    }
  }

  return { bankLedgers, partyLedgers, allLedgers: all };
}

export interface TallyStockItemInfo {
  name: string;
  baseUnits?: string;
  hsnCode?: string;
  openingBalance?: string;
}

export function buildFetchStockItemsQuery(company: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<ENVELOPE>
 <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ATITSStockItemsCollection</ID></HEADER>
 <BODY><DESC>
  <STATICVARIABLES>
   <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
   <SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>
  </STATICVARIABLES>
  <TDL><TDLMESSAGE>
   <COLLECTION NAME="ATITSStockItemsCollection" ISMODIFY="No">
    <TYPE>StockItem</TYPE>
    <FETCH>Name, BaseUnits, OpeningBalance, ClosingBalance, HsnCode</FETCH>
   </COLLECTION>
  </TDLMESSAGE></TDL>
 </DESC></BODY>
</ENVELOPE>`;
}

export function parseTallyStockItems(raw: string): TallyStockItemInfo[] {
  const items: TallyStockItemInfo[] = [];
  const re = /<STOCKITEM[\s>][\s\S]*?<\/STOCKITEM>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const block = m[0];
    const nameMatch = block.match(/<NAME[^>]*>([^<]+)<\/NAME>/i) || block.match(/NAME="([^"]+)"/i);
    const unitsMatch = block.match(/<BASEUNITS[^>]*>([^<]+)<\/BASEUNITS>/i);
    const hsnMatch = block.match(/<HSNCODE[^>]*>([^<]+)<\/HSNCODE>/i);
    const opBalMatch = block.match(/<OPENINGBALANCE[^>]*>([^<]+)<\/OPENINGBALANCE>/i);
    if (nameMatch && nameMatch[1].trim()) {
      items.push({
        name: decodeXml(nameMatch[1].trim()),
        baseUnits: unitsMatch ? decodeXml(unitsMatch[1].trim()) : 'GMS',
        hsnCode: hsnMatch ? decodeXml(hsnMatch[1].trim()) : undefined,
        openingBalance: opBalMatch ? decodeXml(opBalMatch[1].trim()) : undefined,
      });
    }
  }
  return items;
}

export async function fetchTallyStockItems(company: string): Promise<{
  stockItems: TallyStockItemInfo[];
  error?: string;
}> {
  const key = getLicenseKey();
  if (!key) return { stockItems: [], error: 'No license key set in Company Settings.' };
  if (!company?.trim()) return { stockItems: [], error: 'No Tally company specified.' };

  const res = await queryTallyViaCloudflareRelay(buildFetchStockItemsQuery(company), key);
  if (!res.success || !res.tallyResponse) {
    return { stockItems: [], error: res.error || 'No response from bridge' };
  }
  const stockItems = parseTallyStockItems(res.tallyResponse);
  return { stockItems };
}

export async function fetchTallyBillingMasters(company: string): Promise<{
  postLedgers: string[];
  salesLedgers: string[];
  stockItems: TallyStockItemInfo[];
  bankLedgers: string[];
  error?: string;
}> {
  const [ledgersRes, stockRes] = await Promise.all([
    fetchTallyLedgers(company),
    fetchTallyStockItems(company),
  ]);

  if (ledgersRes.error && stockRes.error) {
    return {
      postLedgers: [],
      salesLedgers: [],
      stockItems: [],
      bankLedgers: [],
      error: ledgersRes.error || stockRes.error,
    };
  }

  const allLedgers = ledgersRes.allLedgers || [];
  const postLedgers: string[] = [];
  const salesLedgers: string[] = [];
  const bankLedgers: string[] = [];

  for (const item of allLedgers) {
    const parentLower = item.parent.toLowerCase();
    const nameLower = item.name.toLowerCase();

    if (
      parentLower.includes('bank') ||
      parentLower.includes('od') ||
      parentLower.includes('occ') ||
      /bank|hdfc|icici|sbi|axis|pnb|canara|kotak|bob|union|indusind/i.test(item.name)
    ) {
      bankLedgers.push(item.name);
    } else if (
      parentLower.includes('sales') ||
      nameLower.includes('sales') ||
      nameLower.includes('gst sale') ||
      nameLower.includes('taxable sale')
    ) {
      salesLedgers.push(item.name);
    } else if (
      !parentLower.includes('duties') &&
      !parentLower.includes('tax') &&
      !parentLower.includes('indirect exp') &&
      !parentLower.includes('direct exp')
    ) {
      // Party / Post accounts (Sundry Debtors, Cash-in-hand, Sundry Creditors, etc.)
      postLedgers.push(item.name);
    } else {
      postLedgers.push(item.name);
    }
  }

  return {
    postLedgers,
    salesLedgers: salesLedgers.length > 0 ? salesLedgers : ['SALES', 'GST SALES 3%'],
    stockItems: stockRes.stockItems,
    bankLedgers,
  };
}
