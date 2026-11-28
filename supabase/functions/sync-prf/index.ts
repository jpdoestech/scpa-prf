import { createClient } from 'npm:@supabase/supabase-js@2.89.0';

type Delivery = {
  event_id: number;
  lease_id: string;
  snapshot: Record<'requester' | 'branch' | 'position' | 'headcount' | 'area' | 'needed' | 'requisition' | 'assignment', string>
    & { number: string | null; needed_to?: string | null };
  attempts: number;
  event: Record<string, string>;
};

const columns = [
  'Event ID', 'Time (PHT)', 'PRF number', 'Request ID', 'Action', 'Stage', 'Previous status',
  'Status after action', 'Actor', 'Requester', 'Branch / office', 'Position', 'Headcount',
  'Assigned area / store', 'Date needed', 'Requisition type', 'Work assignment',
];
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function secret(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing configuration: ${name}`);
  return value;
}

function equalSecret(expected: string, supplied: string): boolean {
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return difference === 0;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function fetchJSON(url: string, operation: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${operation} failed (HTTP ${response.status})`);
  }
  return response.json();
}

async function sheetsToken(): Promise<string> {
  const service = JSON.parse(secret('GOOGLE_SERVICE_ACCOUNT_JSON'));
  const now = Math.floor(Date.now() / 1000);
  const tokenURL = 'https://oauth2.googleapis.com/token';
  const encode = (value: object) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const claims = encode({ iss: service.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: tokenURL, iat: now, exp: now + 3600 });
  const message = `${encode({ alg: 'RS256', typ: 'JWT' })}.${claims}`;
  const pem = service.private_key.replace(/-----[^-]+-----|\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(message));
  const response = await fetchJSON(tokenURL, 'Google authorization', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${message}.${base64url(new Uint8Array(signature))}` }),
  });
  if (!response.access_token) throw new Error('Google authorization returned no access token');
  return response.access_token;
}

async function syncSheet(items: Delivery[]) {
  const token = await sheetsToken();
  const spreadsheet = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(secret('GOOGLE_SPREADSHEET_ID'))}`;
  const name = Deno.env.get('GOOGLE_SHEET_TAB') ?? 'PRF Transactions';
  const range = `'${name.replace(/'/g, "''")}'`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const neededRows = Math.max(...items.map(item => item.event_id + 1));
  const meta = await fetchJSON(`${spreadsheet}?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))`, 'Read sheet structure', { headers });
  const tab = meta.sheets?.find((sheet: { properties: { title: string } }) => sheet.properties.title === name)?.properties;
  if (!tab?.gridProperties) throw new Error('Create the dedicated transactions tab before running sync');
  const requests = [];
  if (tab.gridProperties.rowCount < neededRows) {
    requests.push({ appendDimension: { sheetId: tab.sheetId, dimension: 'ROWS', length: neededRows - tab.gridProperties.rowCount } });
  }
  if (tab.gridProperties.columnCount < columns.length) {
    requests.push({ appendDimension: { sheetId: tab.sheetId, dimension: 'COLUMNS', length: columns.length - tab.gridProperties.columnCount } });
  }
  if (requests.length) {
    await fetchJSON(`${spreadsheet}:batchUpdate`, 'Expand transaction sheet', {
      method: 'POST', headers, body: JSON.stringify({ requests }),
    });
  }
  const data: { range: string; values: (string | number)[][] }[] = [
    { range: `${range}!A1:Q1`, values: [columns] },
  ];
  for (const { event_id, snapshot: s, event: e } of items) {
    const parts = Object.fromEntries(clock.formatToParts(new Date(e.occurred_at)).map(({ type, value }) => [type, value]));
    const timestamp = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
    data.push({
      range: `${range}!A${event_id + 1}:Q${event_id + 1}`,
      values: [[event_id, timestamp, s.number ?? '', e.request_id, e.action, e.stage, e.previous_status ?? '',
        e.status, e.actor_name, s.requester, s.branch, s.position, Number(s.headcount), s.area,
        s.needed_to && s.needed_to !== s.needed ? `${s.needed} to ${s.needed_to}` : s.needed, s.requisition, s.assignment]],
    });
  }
  await fetchJSON(`${spreadsheet}/values:batchUpdate`, 'Write transaction rows', {
    method: 'POST', headers, body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });
}

const diagnostic = (e: unknown) => e instanceof Error &&
  /^(Missing configuration: |[a-zA-Z ]+ failed \(HTTP |Create the dedicated )/.test(e.message)
  ? e.message : 'Delivery failed. Check worker configuration and provider availability.';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  const auth = Deno.env.get('PRF_SYNC_SECRET') ?? '';
  if (!equalSecret(auth, req.headers.get('x-prf-sync-secret') ?? '')) {
    return new Response(null, { status: 401 });
  }
  try {
    const db = createClient(secret('SUPABASE_URL'), secret('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const claim = await db.rpc('prf_claim_deliveries', { batch_size: 8 });
    if (claim.error) throw new Error('Claim deliveries failed (HTTP 500)');
    const items = claim.data as Delivery[];
    let sheetsError = null;
    if (items.length) {
      try { await syncSheet(items); } catch (err) { sheetsError = diagnostic(err); }
    }
    const sheetsAt = sheetsError ? null : new Date().toISOString();
    let updateFailures = 0;
    for (const item of items) {
      const minutes = Math.min(60, 2 ** Math.min(item.attempts - 1, 6));
      const update = await db.from('delivery_queue').update({
        sheets_at: sheetsAt, last_error: sheetsError,
        next_attempt_at: new Date(Date.now() + minutes * 60_000).toISOString(),
        lease_until: null, lease_id: null,
      }).eq('event_id', item.event_id).eq('lease_id', item.lease_id);
      if (update.error) updateFailures += 1;
    }
    return Response.json({ claimed: items.length, retries: sheetsError ? items.length : 0, updateFailures },
      { status: updateFailures ? 500 : 200 });
  } catch (err) {
    return Response.json({ error: diagnostic(err) }, { status: 500 });
  }
});
