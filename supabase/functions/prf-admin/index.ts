import { createClient } from 'npm:@supabase/supabase-js@2.89.0';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const reply = (body: object, status = 200) => Response.json(body, { headers, status });
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!['GET', 'POST'].includes(req.method)) return reply({ error: 'Unsupported method.' }, 405);

  const token = req.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return reply({ error: 'Sign in first.' }, 401);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authError } = await db.auth.getUser(token);
  if (authError || !user) return reply({ error: 'Sign in again.' }, 401);
  if (!user.email_confirmed_at || user.app_metadata.prf_super_admin !== true) {
    return reply({ error: 'PRF super administrator access is required.' }, 403);
  }

  const { data: approvers, error: lookupError } = await db.from('staff').select('id,name,account_role')
    .eq('active', true).in('account_role', ['supervisor', 'hrd']).order('name');
  if (lookupError) return reply({ error: 'Could not load PRF approvers.' }, 500);
  if (req.method === 'GET') return reply({ approvers });

  const values = await req.json().catch(() => null);
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return reply({ error: 'Enter the account details.' }, 400);
  }
  const email = text(values.email).toLowerCase();
  const name = text(values.name);
  const branch = text(values.branch);
  const role = text(values.role);
  const password = typeof values.password === 'string' ? values.password : '';
  const supervisor_id = text(values.supervisor_id) || null;
  const hrd_id = text(values.hrd_id) || null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
    !name || name.length > 100 || !branch || branch.length > 100 ||
    !['employee', 'supervisor', 'hrd', 'other'].includes(role) || password.length < 12 || password.length > 72 ||
    new TextEncoder().encode(password).length > 72) {
    return reply({ error: 'Enter a valid email, name, branch, role, and a password of 12 to 72 bytes.' }, 400);
  }
  if (Boolean(supervisor_id) !== Boolean(hrd_id) || (role === 'employee' && !supervisor_id)) {
    return reply({ error: 'Choose both a supervisor and an HRD approver.' }, 400);
  }
  if (supervisor_id && hrd_id &&
    (!uuid.test(supervisor_id) || !uuid.test(hrd_id) || supervisor_id === hrd_id ||
    !approvers.some(p => p.id === supervisor_id && p.account_role === 'supervisor') ||
    !approvers.some(p => p.id === hrd_id && p.account_role === 'hrd'))) {
    return reply({ error: 'Choose two distinct active approvers for the correct stages.' }, 400);
  }

  const { error } = await db.auth.admin.createUser({
    email, password, email_confirm: true,
    app_metadata: { prf_staff: { name, branch, role, supervisor_id, hrd_id } },
  });
  if (error?.code === 'email_exists' || error?.code === 'user_already_exists') {
    return reply({ error: 'An account already exists for this email.' }, 409);
  }
  if (error?.code === 'weak_password') return reply({ error: 'Choose a stronger initial password.' }, 400);
  if (error) return reply({ error: 'Could not create the account. Check the details and try again.' }, 500);
  return reply({ email }, 201);
});
