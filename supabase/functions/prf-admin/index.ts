import { createClient } from 'npm:@supabase/supabase-js@2.89.0';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store',
};
const reply = (body: object, status = 200) => Response.json(body, { headers, status });
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const roles = ['employee', 'supervisor', 'hrd', 'other'];
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

  if (req.method === 'GET') {
    const { data: branches, error: branchError } = await db.from('branches').select('id,name').order('name');
    if (branchError) return reply({ error: 'Could not load branches.' }, 500);
    const branchNames = new Map(branches.map(branch => [branch.id, branch.name]));
    const accounts = [];
    for (let page: number | null = 1; page; ) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
      if (error) return reply({ error: 'Could not load user accounts.' }, 500);
      const ids = data.users.map(account => account.id);
      if (!ids.length) break;
      const { data: profiles, error: profileError } = await db.from('staff')
        .select('id,name,account_role,active,branch_id,supervisor_override,hrd_override').in('id', ids);
      if (profileError) return reply({ error: 'Could not load PRF staff profiles.' }, 500);
      const byId = new Map(profiles.map(profile => [profile.id, profile]));
      for (const account of data.users) {
        const profile = byId.get(account.id);
        accounts.push({
          id: account.id, email: account.email ?? '', name: profile?.name ?? '',
          role: profile?.account_role ?? '', active: profile?.active ?? null,
          branch_id: profile?.branch_id ?? '',
          branch: branchNames.get(profile?.branch_id) ?? '',
          supervisor_id: profile?.supervisor_override ?? '', hrd_id: profile?.hrd_override ?? '',
          superAdmin: account.app_metadata.prf_super_admin === true,
        });
      }
      page = data.nextPage;
    }
    return reply({ accounts, branches, approvers: accounts.filter(account => account.active && ['supervisor', 'hrd'].includes(account.role))
      .map(({ id, name, role }) => ({ id, name, account_role: role })) });
  }

  const values = await req.json().catch(() => null);
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return reply({ error: 'Enter the account details.' }, 400);
  }

  const action = values.action ?? 'create';
  if (action === 'create-branch') {
    const branchName = text(values.branch_name);
    if (!branchName || branchName.length > 100) return reply({ error: 'Enter a branch name of 1 to 100 characters.' }, 400);
    const { data, error } = await db.rpc('prf_create_branch', { branch_name: branchName });
    if (error?.code === 'P0001' || error?.code === '23505') return reply({ error: 'That branch already exists.' }, 409);
    if (error) return reply({ error: 'Could not add this branch.' }, 500);
    return reply({ branch: data }, 201);
  }
  if (!['create', 'save', 'reset'].includes(action)) return reply({ error: 'Unsupported action.' }, 400);
  const id = text(values.account_id);
  const password = typeof values.password === 'string' ? values.password : '';
  if (action !== 'save' && (password.length < 12 || new TextEncoder().encode(password).length > 72)) {
    return reply({ error: 'Use a password of at least 12 characters and no more than 72 bytes.' }, 400);
  }
  if (action !== 'create' && !uuid.test(id)) return reply({ error: 'Choose a user account.' }, 400);

  if (action === 'reset') {
    const { data, error } = await db.auth.admin.getUserById(id);
    if (error || !data.user) return reply({ error: 'User account unavailable.' }, 404);
    if (data.user.app_metadata.prf_super_admin === true) {
      return reply({ error: 'Reset super-admin passwords through the Supabase administrator.' }, 403);
    }
    const { error: resetError } = await db.auth.admin.updateUserById(id, { password });
    if (resetError?.code === 'weak_password') return reply({ error: 'Choose a stronger password.' }, 400);
    if (resetError) return reply({ error: 'Could not reset this password.' }, 500);
    return reply({ email: data.user.email });
  }

  const email = text(values.email).toLowerCase();
  const name = text(values.name);
  const branchId = text(values.branch_id);
  const previousBranch = text(values.branch);
  const role = text(values.role);
  const active = action === 'create' || values.active === 'true';
  const supervisor_id = text(values.supervisor_id) || null;
  const hrd_id = text(values.hrd_id) || null;
  if ((action === 'create' && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) ||
    !name || name.length > 100 || !roles.includes(role)
    || (action === 'save' && !['true', 'false'].includes(values.active))) {
    return reply({ error: 'Enter a valid email, name, and role.' }, 400);
  }
  if (!(branchId || previousBranch) || branchId.length > 100 || previousBranch.length > 100) {
    return reply({ error: 'Choose an existing branch.' }, 400);
  }
  if (Boolean(supervisor_id) !== Boolean(hrd_id) || (active && role === 'employee' && !supervisor_id)
    || (supervisor_id && hrd_id &&
      (!uuid.test(supervisor_id) || !uuid.test(hrd_id) || supervisor_id === hrd_id || id === supervisor_id || id === hrd_id))) {
    return reply({ error: 'Choose two distinct approvers.' }, 400);
  }
  // Older clients may still send a branch name. Both paths must resolve an existing branch.
  const { data: branch, error: branchError } = await db.from('branches').select('name')
    .eq(branchId ? 'id' : 'name', branchId || previousBranch).maybeSingle();
  if (branchError) return reply({ error: 'Could not check the selected branch.' }, 500);
  if (!branch) return reply({ error: 'Choose an existing branch.' }, 400);
  const profile = { name, branch: branch.name, role, active, supervisor_id, hrd_id };
  if (action === 'save') {
    const { error } = await db.rpc('prf_save_staff', { user_id: id, profile });
    if (error?.code === 'P0001') return reply({ error: error.message }, 409);
    if (error?.code === '23503') return reply({ error: 'User account unavailable.' }, 404);
    if (error) return reply({ error: 'Could not save the PRF profile.' }, 500);
    return reply({ id });
  }

  if (supervisor_id && hrd_id) {
    const { data, error } = await db.from('staff').select('id,account_role').eq('active', true).in('id', [supervisor_id, hrd_id]);
    if (error) return reply({ error: 'Could not check PRF approvers.' }, 500);
    if (!data.some(p => p.id === supervisor_id && p.account_role === 'supervisor')
      || !data.some(p => p.id === hrd_id && p.account_role === 'hrd')) {
      return reply({ error: 'Choose active approvers for the correct stages.' }, 400);
    }
  }
  const { data, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true, app_metadata: { prf_staff: profile },
  });
  if (error?.code === 'email_exists' || error?.code === 'user_already_exists') {
    return reply({ error: 'An account already exists for this email.' }, 409);
  }
  if (error?.code === 'weak_password') return reply({ error: 'Choose a stronger initial password.' }, 400);
  if (error || !data.user) return reply({ error: 'Could not create the account. Check the details and try again.' }, 500);
  return reply({ id: data.user.id, email }, 201);
});
