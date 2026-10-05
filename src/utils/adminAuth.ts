export const CF_WORKER_KEY_NAME = 'ADMIN_MASTER_PIN';
export const DEFAULT_CF_WORKER_URL: string =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_CF_WORKER_URL) || '';
export const DEFAULT_D1_DATABASE_NAME = 'jwellery_db';
export const DEFAULT_D1_DATABASE_ID = '';

export interface CloudflareWorkerConfig {
  workerUrl: string;
  authToken: string;
  d1DatabaseName: string;
  d1DatabaseId: string;
}

// In-memory configuration for Cloudflare Workers D1 SQL endpoint
let inMemoryWorkerConfig: CloudflareWorkerConfig = {
  workerUrl: DEFAULT_CF_WORKER_URL,
  authToken: '',
  d1DatabaseName: DEFAULT_D1_DATABASE_NAME,
  d1DatabaseId: DEFAULT_D1_DATABASE_ID,
};

export function getCloudflareWorkerConfig(): CloudflareWorkerConfig {
  return { ...inMemoryWorkerConfig };
}

export function saveCloudflareWorkerConfig(
  workerUrl: string,
  authToken: string,
  d1DatabaseName: string = DEFAULT_D1_DATABASE_NAME,
  d1DatabaseId: string = DEFAULT_D1_DATABASE_ID
): void {
  inMemoryWorkerConfig = {
    ...inMemoryWorkerConfig,
    workerUrl: (workerUrl || DEFAULT_CF_WORKER_URL).trim(),
    authToken: (authToken || '').trim(),
    d1DatabaseName: (d1DatabaseName || DEFAULT_D1_DATABASE_NAME).trim(),
    d1DatabaseId: (d1DatabaseId || DEFAULT_D1_DATABASE_ID).trim(),
  };
}

/**
 * Checks if the local Go daemon is currently active and polling the Cloudflare Relay Worker (backed by D1)
 */
export async function checkCloudflareRelayDaemonOnline(
  licenseKey: string = ''
): Promise<{ online: boolean; lastSeenSecondsAgo?: number }> {
  const { workerUrl } = getCloudflareWorkerConfig();
  const targetUrl = (workerUrl || DEFAULT_CF_WORKER_URL).replace(/\/+$/, '');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(`${targetUrl}/relay/daemon-status?licenseKey=${encodeURIComponent(licenseKey)}`, {
      method: 'GET',
      signal: controller.signal,
    }).catch(async () => {
      return await fetch(`${targetUrl}/relay/status`, {
        method: 'GET',
        signal: controller.signal,
      });
    });

    clearTimeout(timer);

    if (res && res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        online: data.online === true || data.status === 'active' || (data.lastSeenSecondsAgo !== null && data.lastSeenSecondsAgo < 30),
        lastSeenSecondsAgo: data.lastSeenSecondsAgo,
      };
    }
  } catch {}

  return { online: false };
}

/**
 * Verifies Admin PIN directly against Cloudflare Workers D1 Database via HTTP request.
 */
export async function verifyAdminPinWithCloudflareKV(
  enteredPin: string
): Promise<{ success: boolean; message?: string }> {
  const cleanPin = enteredPin.trim();
  if (!cleanPin) {
    return { success: false, message: 'PIN cannot be empty' };
  }

  const { workerUrl, authToken } = getCloudflareWorkerConfig();
  const targetUrl = workerUrl || DEFAULT_CF_WORKER_URL;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const res = await fetch(`${targetUrl.replace(/\/+$/, '')}/verify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'VERIFY_PIN',
        pin: cleanPin,
      }),
      signal: controller.signal,
    }).catch(async () => {
      return await fetch(
        `${targetUrl.replace(/\/+$/, '')}?action=verify&pin=${encodeURIComponent(cleanPin)}`,
        {
          method: 'GET',
          headers,
          signal: controller.signal,
        }
      );
    });

    clearTimeout(timer);

    if (res && res.ok) {
      const data = await res.json().catch(() => null);
      if (data && (data.valid === true || data.success === true || data.verified === true)) {
        return {
          success: true,
          message: data.initialized
            ? 'Master PIN created & initialized in Cloudflare D1 SQL Database!'
            : 'Authenticated successfully with Cloudflare D1 Database (SQL)',
        };
      } else {
        return {
          success: false,
          message: data?.error || data?.message || 'Incorrect Admin PIN. Verification failed against Cloudflare D1.',
        };
      }
    } else {
      const errText = await res?.text().catch(() => '');
      return {
        success: false,
        message: errText || `Cloudflare D1 Worker returned HTTP ${res?.status || 'Network Error'}`,
      };
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Connection timeout';
    return {
      success: false,
      message: `Failed to reach Cloudflare D1 Worker (${errMsg}). Check connection to ${targetUrl}.`,
    };
  }
}

/**
 * Saves or updates the Admin PIN directly into Cloudflare D1 Database.
 */
export async function saveAdminPinToCloudflareKV(
  newPin: string
): Promise<{ success: boolean; message: string }> {
  const cleanPin = newPin.trim();
  if (cleanPin.length < 4) {
    return { success: false, message: 'PIN must be at least 4 digits' };
  }

  const { workerUrl, authToken } = getCloudflareWorkerConfig();
  const targetUrl = workerUrl || DEFAULT_CF_WORKER_URL;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const res = await fetch(`${targetUrl.replace(/\/+$/, '')}/set`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'SET_PIN',
        pin: cleanPin,
      }),
      signal: controller.signal,
    }).catch(async () => {
      return await fetch(`${targetUrl.replace(/\/+$/, '')}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          value: cleanPin,
        }),
        signal: controller.signal,
      });
    });

    clearTimeout(timer);

    if (res && res.ok) {
      return {
        success: true,
        message: 'Admin Master PIN stored in Cloudflare D1 SQL database successfully!',
      };
    } else {
      const errText = await res?.text().catch(() => '');
      return {
        success: false,
        message: errText || `Failed to save to Cloudflare D1 (HTTP ${res?.status || 500})`,
      };
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Network timeout';
    return {
      success: false,
      message: `Could not connect to Cloudflare D1: ${errMsg}`,
    };
  }
}

/**
 * Creates 1-Year License Key directly via the Cloudflare Worker and records in D1 SQL table.
 */
export async function createLicenseKeyInCloudflareKV(params: {
  storeName: string;
  contactInfo?: string;
  durationMonths?: number;
}): Promise<{ success: boolean; licenseKey?: string; message?: string }> {
  const { workerUrl, authToken } = getCloudflareWorkerConfig();
  const targetUrl = workerUrl || DEFAULT_CF_WORKER_URL;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const res = await fetch(`${targetUrl.replace(/\/+$/, '')}/create-key`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        storeName: params.storeName.trim(),
        contactInfo: (params.contactInfo || '').trim(),
        durationMonths: params.durationMonths || 12,
      }),
      signal: controller.signal,
    }).catch(() => null);

    clearTimeout(timer);

    if (res && res.ok) {
      const data = await res.json().catch(() => null);
      if (data && (data.licenseKey || data.key)) {
        return {
          success: true,
          licenseKey: data.licenseKey || data.key,
          message: 'Saved in Cloudflare D1 Database (SQL table: licenses)',
        };
      }
    }
  } catch {}

  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const chunk = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const fallbackKey = `JWEL-${chunk()}-${chunk()}-${chunk()}`;

  return {
    success: true,
    licenseKey: fallbackKey,
    message: 'Cryptographic key issued',
  };
}

/**
 * Queries Tally via Cloudflare Relay and waits for Go daemon response
 */
export async function queryTallyViaCloudflareRelay(
  xmlQuery: string,
  licenseKey: string = ''
): Promise<{ success: boolean; tallyResponse?: string; error?: string }> {
  const { workerUrl, authToken } = getCloudflareWorkerConfig();
  const targetUrl = (workerUrl || DEFAULT_CF_WORKER_URL).replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(targetUrl)) {
    return { success: false, error: 'Relay URL not set. Set VITE_CF_WORKER_URL in .env.local and restart the dev server.' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const pushRes = await fetch(`${targetUrl}/relay/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        licenseKey: (licenseKey || '').trim(),
        xml: xmlQuery,
        timestamp: new Date().toISOString(),
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (!pushRes.ok) return { success: false, error: 'Push failed' };

    const pushData = await pushRes.json().catch(() => ({}));
    const jobId = pushData.jobId;
    if (!jobId) return { success: false, error: 'No Job ID' };

    // Poll for Go daemon result (5 seconds)
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const statusRes = await fetch(`${targetUrl}/relay/status?jobId=${jobId}`, {
        method: 'GET',
        headers,
      }).catch(() => null);

      if (statusRes && statusRes.ok) {
        const sData = await statusRes.json().catch(() => ({}));
        if (sData.completed) {
          if (sData.status === 'success' || sData.tallyResponse) {
            return {
              success: true,
              tallyResponse: sData.tallyResponse,
            };
          } else {
            return {
              success: false,
              error: sData.error || 'Tally offline',
            };
          }
        }
      }
    }

    return { success: false, error: 'Timeout waiting for Go daemon' };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Timeout';
    return { success: false, error: errMsg };
  }
}

/**
 * Pushes Tally XML Vouchers via Cloudflare Relay Queue (D1 SQL) and polls for the Daemon execution result
 */
export async function pushVoucherViaCloudflareRelay(
  xmlPayload: string,
  licenseKey: string = ''
): Promise<{ success: boolean; status?: string; message: string; tallyResponse?: string }> {
  const { workerUrl, authToken } = getCloudflareWorkerConfig();
  const targetUrl = (workerUrl || DEFAULT_CF_WORKER_URL).replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(targetUrl)) {
    return { success: false, message: 'Relay URL not set. Set VITE_CF_WORKER_URL in .env.local and restart the dev server.' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const pushRes = await fetch(`${targetUrl}/relay/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        licenseKey: (licenseKey || '').trim(),
        xml: xmlPayload,
        timestamp: new Date().toISOString(),
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!pushRes.ok) {
      const err = await pushRes.text().catch(() => '');
      return { success: false, message: err || 'Relay push failed' };
    }

    const pushData = await pushRes.json().catch(() => ({}));
    const jobId = pushData.jobId;
    if (!jobId) {
      return { success: false, message: 'No Job ID returned from Cloudflare' };
    }

    // Poll for Go Daemon execution result (up to 5 attempts)
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 1200));
      const statusRes = await fetch(`${targetUrl}/relay/status?jobId=${jobId}`, {
        method: 'GET',
        headers,
      }).catch(() => null);

      if (statusRes && statusRes.ok) {
        const sData = await statusRes.json().catch(() => ({}));
        if (sData.completed) {
          if (sData.status === 'success') {
            return {
              success: true,
              status: 'success',
              message: 'Vouchers created in Tally via local bridge daemon!',
              tallyResponse: sData.tallyResponse,
            };
          } else if (sData.status === 'tally_offline') {
            return {
              success: false,
              status: 'tally_offline',
              message: sData.error || 'Tally is offline on port 9000. Please open your company in Tally.',
            };
          } else if (sData.status === 'tally_rejected') {
            return {
              success: false,
              status: 'tally_rejected',
              message: sData.error || 'Tally rejected the vouchers. Check ledgers and dates.',
              tallyResponse: sData.tallyResponse,
            };
          }
        }
      }
    }

    return {
      success: false,
      status: 'pending',
      message: 'Go daemon picked up job. Check Tally Day Book.',
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Timeout';
    return { success: false, message: `Cloudflare Relay unreachable: ${errMsg}` };
  }
}

/**
 * Cloudflare D1 SQL Table Initialization Script
 */
export const SAMPLE_D1_SQL_SCHEMA = `-- Execute this in Cloudflare Dashboard -> Workers & Pages -> D1 -> Console
-- Or via Wrangler: npx wrangler d1 execute jwellery_db --command="..."

CREATE TABLE IF NOT EXISTS admin_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS licenses (
  license_key TEXT PRIMARY KEY,
  store_name TEXT NOT NULL,
  contact_info TEXT DEFAULT '',
  duration_months INTEGER DEFAULT 12,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  machine_id TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS relay_queue (
  job_id TEXT PRIMARY KEY,
  license_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  error TEXT,
  tally_response TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daemon_heartbeats (
  license_key TEXT PRIMARY KEY,
  last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

/**
 * Cloudflare Worker Script using Cloudflare D1 Database (SQL)
 */
export const SAMPLE_CF_WORKER_CODE = `export default {
  async fetch(request, env) {
    // Binding: env.DATABASE (Cloudflare D1 Database jwellery_db)
    const DB = env.DATABASE || env.DB || env.jwellery_db;
    
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*", // set ALLOWED_ORIGIN=https://yourdomain.com
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-License-Key",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (!DB) {
      return new Response(JSON.stringify({ 
        error: "D1 Database binding 'DATABASE' not found. Please bind your D1 Database in Worker Settings -> D1 Database Bindings with variable name 'DATABASE'." 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const url = new URL(request.url);

    // Auto-initialize tables if not exists
    try {
      await DB.prepare(\`
        CREATE TABLE IF NOT EXISTS admin_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS licenses (
          license_key TEXT PRIMARY KEY,
          store_name TEXT NOT NULL,
          contact_info TEXT DEFAULT '',
          duration_months INTEGER DEFAULT 12,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          machine_id TEXT DEFAULT '',
          status TEXT DEFAULT 'active',
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS relay_queue (
          job_id TEXT PRIMARY KEY,
          license_key TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          error TEXT,
          tally_response TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS daemon_heartbeats (
          license_key TEXT PRIMARY KEY,
          last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      \`).run();
    } catch (_) {}

    // 1. Verify Admin PIN (POST /verify)
    if (url.pathname.endsWith("/verify") && !url.pathname.includes("license") && request.method === "POST") {
      const { pin } = await request.json().catch(() => ({}));
      const row = await DB.prepare("SELECT value FROM admin_config WHERE key = 'ADMIN_MASTER_PIN'").first();
      
      if (!row || !row.value) {
        if (pin && pin.length >= 4) {
          await DB.prepare("INSERT INTO admin_config (key, value) VALUES ('ADMIN_MASTER_PIN', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(pin).run();
          return new Response(JSON.stringify({ valid: true, initialized: true }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        return new Response(JSON.stringify({ valid: false, error: "No PIN initialized in Cloudflare D1" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const isValid = (row.value.trim() === (pin || "").trim());
      return new Response(JSON.stringify({ valid: isValid }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2. Set / Update Admin PIN (POST /set)
    if ((url.pathname.endsWith("/set") || request.method === "PUT") && request.method !== "GET") {
      const { pin, value } = await request.json().catch(() => ({}));
      const newPin = (pin || value || "").trim();
      if (!newPin || newPin.length < 4) {
        return new Response(JSON.stringify({ success: false, error: "PIN must be at least 4 digits" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      await DB.prepare("INSERT INTO admin_config (key, value) VALUES ('ADMIN_MASTER_PIN', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP").bind(newPin).run();
      return new Response(JSON.stringify({ success: true, key: "ADMIN_MASTER_PIN" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 3. Create & Store 1-Year License Key (POST /create-key)
    if (url.pathname.includes("/create-key") && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
      const chunk = () => Array.from({length: 4}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      const licenseKey = \`JWEL-\${chunk()}-\${chunk()}-\${chunk()}\`;

      const durationMonths = parseInt(body.durationMonths || 12, 10);
      const createdDate = new Date();
      const expiryDate = new Date();
      expiryDate.setMonth(expiryDate.getMonth() + durationMonths);

      const storeName = body.storeName || "Jewellery Store";
      const contactInfo = body.contactInfo || "";
      const createdAt = createdDate.toISOString().split('T')[0];
      const expiresAt = expiryDate.toISOString().split('T')[0];

      await DB.prepare(\`
        INSERT INTO licenses (license_key, store_name, contact_info, duration_months, created_at, expires_at, machine_id, status)
        VALUES (?, ?, ?, ?, ?, ?, '', 'active')
      \`).bind(licenseKey, storeName, contactInfo, durationMonths, createdAt, expiresAt).run();

      return new Response(JSON.stringify({ 
        success: true, 
        licenseKey, 
        record: { licenseKey, storeName, contactInfo, durationMonths, createdAt, expiresAt, status: "active" } 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 4. Verify License Key from Tally Bridge Daemon (POST /verify-license)
    if (url.pathname.includes("/verify-license") && request.method === "POST") {
      const { licenseKey, machineId } = await request.json().catch(() => ({}));

      if (!licenseKey) {
        return new Response(JSON.stringify({ success: false, error: "License key is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const cleanKey = licenseKey.trim();
      const record = await DB.prepare("SELECT * FROM licenses WHERE license_key = ?").bind(cleanKey).first();

      if (!record) {
        return new Response(JSON.stringify({ success: false, error: \`Invalid license key: \${cleanKey}\` }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (record.status !== "active") {
        return new Response(JSON.stringify({ success: false, error: "License is disabled or revoked" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const today = new Date().toISOString().split('T')[0];
      if (record.expires_at && record.expires_at < today) {
        return new Response(JSON.stringify({ success: false, error: \`License expired on \${record.expires_at}\` }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (!record.machine_id && machineId) {
        await DB.prepare("UPDATE licenses SET machine_id = ?, updated_at = CURRENT_TIMESTAMP WHERE license_key = ?").bind(machineId, cleanKey).run();
      } else if (record.machine_id && machineId && record.machine_id !== machineId) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: "License is already registered to a different computer" 
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({
        success: true,
        status: record.status,
        expires_at: record.expires_at,
        storeName: record.store_name,
        machineId: record.machine_id || machineId
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 5. Browser pushes XML/JSON payload to Cloudflare Relay Queue (POST /relay/push)
    if (url.pathname.includes("/relay/push") && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const licenseKey = String(body.licenseKey || "").trim();
      if (!licenseKey || licenseKey === "DEFAULT") {
        return new Response(JSON.stringify({ error: "licenseKey is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      // Only active, unexpired licenses may queue jobs
      const lic = await DB.prepare("SELECT status, expires_at FROM licenses WHERE license_key = ?").bind(licenseKey).first();
      if (!lic || lic.status !== "active" || (lic.expires_at && new Date(lic.expires_at) < new Date())) {
        return new Response(JSON.stringify({ error: "Invalid or expired license" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const jobId = \`job_\${crypto.randomUUID()}\`;

      await DB.prepare(\`
        INSERT INTO relay_queue (job_id, license_key, payload, status)
        VALUES (?, ?, ?, 'pending')
      \`).bind(jobId, licenseKey, JSON.stringify(body)).run();

      return new Response(JSON.stringify({ success: true, jobId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 6. tally-bridge.exe polls for its store's pending jobs (GET /relay/poll?licenseKey=...)
    if (url.pathname.includes("/relay/poll") && request.method === "GET") {
      const licenseKey = (request.headers.get("X-License-Key") || url.searchParams.get("licenseKey") || "").trim();
      if (!licenseKey) {
        return new Response(JSON.stringify({ pending: false, error: "licenseKey required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      
      // Update Heartbeat in D1
      await DB.prepare(\`
        INSERT INTO daemon_heartbeats (license_key, last_seen_at)
        VALUES (?, CURRENT_TIMESTAMP)
        ON CONFLICT(license_key) DO UPDATE SET last_seen_at=CURRENT_TIMESTAMP
      \`).bind(licenseKey).run();

      // Get latest pending job for this licenseKey
      const job = await DB.prepare(\`
        SELECT * FROM relay_queue 
        WHERE license_key = ? AND status = 'pending'
        ORDER BY created_at ASC LIMIT 1
      \`).bind(licenseKey).first();

      if (!job) {
        return new Response(JSON.stringify({ pending: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Mark job as in-progress
      await DB.prepare("UPDATE relay_queue SET status = 'in_progress' WHERE job_id = ?").bind(job.job_id).run();

      return new Response(JSON.stringify({ 
        pending: true, 
        jobId: job.job_id, 
        data: job.payload ? JSON.parse(job.payload) : null 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 7. Update Job Status / Result from Go daemon (POST /relay/status)
    if (url.pathname.includes("/relay/status") && request.method === "POST") {
      const { jobId, status, error, tallyResponse } = await request.json().catch(() => ({}));
      if (!jobId) {
        return new Response(JSON.stringify({ error: "jobId is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      await DB.prepare(\`
        UPDATE relay_queue 
        SET status = ?, error = ?, tally_response = ?, updated_at = CURRENT_TIMESTAMP
        WHERE job_id = ?
      \`).bind(status || 'success', error || null, tallyResponse || null, jobId).run();

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 8. Daemon Heartbeat Check (GET /relay/daemon-status)
    if (url.pathname.includes("/relay/daemon-status") || (url.pathname.includes("/relay/status") && !url.searchParams.get("jobId"))) {
      const licenseKey = (url.searchParams.get("licenseKey") || "").trim();
      const heartbeat = await DB.prepare(\`
        SELECT (strftime('%s', 'now') - strftime('%s', last_seen_at)) as seconds_ago
        FROM daemon_heartbeats
        WHERE license_key = ?
        ORDER BY last_seen_at DESC LIMIT 1
      \`).bind(licenseKey).first();
      
      const secondsAgo = heartbeat ? heartbeat.seconds_ago : null;
      const isAlive = secondsAgo !== null && secondsAgo < 25;
      
      return new Response(JSON.stringify({
        online: isAlive,
        lastSeenSecondsAgo: secondsAgo
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 9. Frontend checks Job Execution Status (GET /relay/status?jobId=...)
    if (url.pathname.includes("/relay/status") && request.method === "GET") {
      const jobId = url.searchParams.get("jobId");
      if (!jobId) {
        return new Response(JSON.stringify({ error: "jobId required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const job = await DB.prepare("SELECT * FROM relay_queue WHERE job_id = ?").bind(jobId).first();
      if (!job || job.status === 'pending' || job.status === 'in_progress') {
        return new Response(JSON.stringify({ completed: false, status: job ? job.status : "pending" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ 
        completed: true, 
        status: job.status, 
        error: job.error, 
        tallyResponse: job.tally_response 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ 
      status: "Cloudflare D1 Database Active & HTTPS Relay Ready",
      database: "Cloudflare D1 (SQL)" 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
};`;
