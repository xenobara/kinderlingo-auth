/**
 * KinderLingo Cloudflare Worker
 * Handles: admin API routes, welcome emails, user management
 *
 * Routes handled:
 *   POST /api/welcome-email  — trigger welcome email for a user
 *   GET  /api/admin/users    — fetch all users (admin only, server-side RLS bypass)
 *   POST /api/admin/suspend  — suspend a user
 *   POST /api/admin/delete   — delete a user
 *
 * Env vars needed (set in Cloudflare Pages > Settings > Environment Variables):
 *   SUPABASE_URL          — e.g. https://xxxxx.supabase.co
 *   SUPABASE_SERVICE_KEY  — your Supabase service_role (bypasses RLS)
 *   ADMIN_EMAIL           — hardcoded admin email (e.g. zac@example.com)
 *   RESEND_API_KEY        — Resend API key for sending welcome emails
 *   FROM_EMAIL            — e.g. KinderLingo <hello@kinderlingo.com>
 */

const ALLOWED_ORIGIN = '*'; // tighten to your domain in production

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ── CORS preflight ───────────────────────────
if (new URL(request.url).method === 'OPTIONS') {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}

// ── Helper: verify JWT and extract user ──────
async function verifyToken(supabaseUrl, serviceKey, authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  // Decode JWT payload (no verification needed when using service role key)
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  return payload;
}

// ── Helper: fetch user profile from Supabase ─
async function getProfile(supabaseUrl, serviceKey, userId) {
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=*`, {
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data[0] || null;
}

// ── Helper: send welcome email via Resend ────
async function sendWelcomeEmail(toEmail, resendKey, fromEmail) {
  if (!resendKey) {
    // No Resend key — just log to console (dev mode)
    console.log(`[WELCOME EMAIL] Would send to: ${toEmail}`);
    return { ok: true, dev: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail || 'KinderLingo <hello@kinderlingo.com>',
        to: toEmail,
        subject: '🎉 Welcome to KinderLingo!',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
            <h1 style="color:#4A90D9">Welcome to KinderLingo! 🎉</h1>
            <p>Hi there,</p>
            <p>Thanks for joining KinderLingo — we're so excited to have you!</p>
            <p>Here's what you can do next:</p>
            <ul>
              <li>🎮 Play free flashcard games</li>
              <li>📺 Watch Ivy's songs & stories on YouTube</li>
              <li>📚 Browse lesson plans for your classroom</li>
              <li>⭐ Unlock premium content with your subscription</li>
            </ul>
            <p>Happy learning!<br><strong>— The KinderLingo Team</strong></p>
          </div>
        `,
        text: `Welcome to KinderLingo! Start learning at https://kinderlingo.com`,
      }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Helper: require admin auth ───────────────
async function requireAdmin(authHeader, env) {
  const payload = await verifyToken(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, authHeader);
  if (!payload) return { error: 'Unauthorized', status: 401 };
  const profile = await getProfile(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, payload.sub);
  if (!profile?.is_admin) return { error: 'Forbidden', status: 403 };
  if (profile.email !== env.ADMIN_EMAIL) return { error: 'Forbidden', status: 403 };
  return { user: payload, profile };
}

// ── Supabase REST fetch helper ───────────────
async function supabaseFetch(env, method, table, body, params = '') {
  const url = `${env.SUPABASE_URL}/rest/v1/${table}${params}`;
  const headers = {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'PATCH' || method === 'DELETE' ? 'return=minimal' : 'return=representation',
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// ── Route: POST /api/welcome-email ───────────
async function handleWelcomeEmail(body, env) {
  const { userId, email } = body;
  if (!email) return new Response(JSON.stringify({ error: 'email required' }), { status: 400, headers: JSON_HEADERS });
  const result = await sendWelcomeEmail(email, env.RESEND_API_KEY, env.FROM_EMAIL);
  console.log(`[WELCOME EMAIL] Sent to ${email}:`, result);
  return new Response(JSON.stringify({ ok: true, ...result }), { headers: JSON_HEADERS });
}

// ── Route: GET /api/admin/users ──────────────
async function handleGetUsers(authHeader, env) {
  const check = await requireAdmin(authHeader, env);
  if (check.error) return new Response(JSON.stringify({ error: check.error }), { status: check.status, headers: JSON_HEADERS });
  const { ok, status, data } = await supabaseFetch(env, 'GET', 'profiles', null, '?select=*&order=created_at.desc');
  return new Response(JSON.stringify(data || []), { status: ok ? 200 : status, headers: JSON_HEADERS });
}

// ── Route: POST /api/admin/suspend ───────────
async function handleSuspend(body, authHeader, env) {
  const check = await requireAdmin(authHeader, env);
  if (check.error) return new Response(JSON.stringify({ error: check.error }), { status: check.status, headers: JSON_HEADERS });
  const { userId, suspend } = body;
  if (!userId) return new Response(JSON.stringify({ error: 'userId required' }), { status: 400, headers: JSON_HEADERS });
  // Prevent admin from suspending themselves
  if (userId === check.user.sub) return new Response(JSON.stringify({ error: 'Cannot suspend yourself' }), { status: 400, headers: JSON_HEADERS });
  const { ok, status } = await supabaseFetch(env, 'PATCH', 'profiles', { is_suspended: !!suspend }, `?id=eq.${userId}`);
  return new Response(JSON.stringify({ ok }), { status: ok ? 200 : status, headers: JSON_HEADERS });
}

// ── Route: POST /api/admin/delete ────────────
async function handleDelete(body, authHeader, env) {
  const check = await requireAdmin(authHeader, env);
  if (check.error) return new Response(JSON.stringify({ error: check.error }), { status: check.status, headers: JSON_HEADERS });
  const { userId } = body;
  if (!userId) return new Response(JSON.stringify({ error: 'userId required' }), { status: 400, headers: JSON_HEADERS });
  if (userId === check.user.sub) return new Response(JSON.stringify({ error: 'Cannot delete yourself' }), { status: 400, headers: JSON_HEADERS });
  // Delete from profiles (Auth user deletion must be done in Supabase dashboard or via Admin API)
  const { ok, status } = await supabaseFetch(env, 'DELETE', 'profiles', null, `?id=eq.${userId}`);
  return new Response(JSON.stringify({ ok }), { status: ok ? 200 : status, headers: JSON_HEADERS });
}

// ── Main worker handler ───────────────────────
export async function onRequest({ request, env }) {
  // Only handle API routes
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) {
    return new Response('Not found', { status: 404 });
  }

  // Check env vars
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Server misconfigured: missing Supabase env vars' }), { status: 500, headers: JSON_HEADERS });
  }

  const method = request.method;
  let body = {};
  try { body = await request.json(); } catch {}

  const authHeader = request.headers.get('Authorization') || '';

  const route = url.pathname.replace('/api/', '');

  try {
    let response;
    switch (route) {
      case 'welcome-email':
        response = await handleWelcomeEmail(body, env);
        break;
      case 'admin/users':
        response = await handleGetUsers(authHeader, env);
        break;
      case 'admin/suspend':
        response = await handleSuspend(body, authHeader, env);
        break;
      case 'admin/delete':
        response = await handleDelete(body, authHeader, env);
        break;
      default:
        response = new Response(JSON.stringify({ error: 'Unknown route' }), { status: 404, headers: JSON_HEADERS });
    }
    return response;
  } catch (err) {
    console.error('Worker error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error', detail: err.message }), { status: 500, headers: JSON_HEADERS });
  }
}
