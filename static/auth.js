// ─────────────────────────────────────────────
//  KinderLingo Auth — Shared Supabase Client
// ─────────────────────────────────────────────
// Replace these with your actual Supabase credentials
export const SUPABASE_URL = 'YOUR_SUPABASE_URL';
export const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
export const ADMIN_EMAIL = 'YOUR_ADMIN_EMAIL@example.com'; // hardcoded check server-side

let supabase = null;

export async function getSupabase() {
  if (supabase) return supabase;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return supabase;
}

// ── Session helpers ──────────────────────────

export async function getSession() {
  const sb = await getSupabase();
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function getUser() {
  const session = await getSession();
  return session?.user ?? null;
}

export async function isLoggedIn() {
  const user = await getUser();
  return !!user;
}

export async function isSubscriber() {
  const user = await getUser();
  if (!user) return false;
  const sb = await getSupabase();
  const { data } = await sb
    .from('profiles')
    .select('is_subscriber')
    .eq('id', user.id)
    .single();
  return data?.is_subscriber === true;
}

export async function isAdmin() {
  const user = await getUser();
  if (!user) return false;
  const sb = await getSupabase();
  const { data } = await sb
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  return data?.is_admin === true;
}

// ── Auth actions ─────────────────────────────

export async function signUp(email, password) {
  const sb = await getSupabase();
  return sb.auth.signUp({ email, password });
}

export async function signIn(email, password) {
  const sb = await getSupabase();
  return sb.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  const sb = await getSupabase();
  return sb.auth.signOut();
}

export async function signInWithGoogle() {
  const sb = await getSupabase();
  return sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/login.html' }
  });
}

// ── Nav auth state ───────────────────────────

export async function updateNavAuthState() {
  const user = await getUser();

  // Auth system pages (login.html, signup.html, etc.)
  const nav = document.getElementById('nav-auth');
  if (nav) {
    if (user) {
      nav.innerHTML = `
        <a href="/auth-system/premium.html" class="nav-premium-btn">⭐ Premium</a>
        <span class="nav-user">${escapeHtml(user.email)}</span>
        <a href="/auth-system/logout.html" class="nav-logout-btn">Logout</a>
      `;
    } else {
      nav.innerHTML = `
        <a href="/auth-system/login.html" class="nav-login-btn">Login</a>
        <a href="/auth-system/signup.html" class="nav-subscribe-btn">Subscribe</a>
      `;
    }
  }

  // Main KinderLingo site (index.html from Flask app) — only if auth system deployed
  const loginLi = document.getElementById('nav-auth-html-login');
  const subscribeLi = document.getElementById('nav-auth-html-subscribe');
  if (loginLi && subscribeLi) {
    if (user) {
      loginLi.innerHTML = `<a href="/auth-system/admin.html" class="nav-premium-btn">⭐ ${escapeHtml(user.email.split('@')[0])}</a>`;
      subscribeLi.innerHTML = `<a href="/auth-system/logout.html" style="color:#999;font-weight:700">Logout</a>`;
    } else {
      loginLi.innerHTML = `<a href="/auth-system/login.html" class="nav-login-btn">Login</a>`;
      subscribeLi.innerHTML = `<a href="/auth-system/signup.html" class="nav-subscribe-btn">Subscribe</a>`;
    }
  }
}

// ── Require auth redirect ────────────────────

export async function requireAuth(redirectTo = '/auth-system/login.html') {
  const loggedIn = await isLoggedIn();
  if (!loggedIn) {
    window.location.href = redirectTo;
    return false;
  }
  return true;
}

export async function requireAdmin(redirectTo = '/auth-system/login.html') {
  const admin = await isAdmin();
  if (!admin) {
    window.location.href = redirectTo;
    return false;
  }
  return true;
}

// ── Protect page if not subscriber ──────────

export async function requireSubscriber(redirectTo = '/auth-system/signup.html') {
  const sub = await isSubscriber();
  if (!sub) {
    window.location.href = redirectTo;
    return false;
  }
  return true;
}

// ── Paywall overlay (shows on premium pages) ─

export async function renderPaywall(containerId = 'content-area') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <style>
      .paywall-wrap { text-align: center; padding: 64px 24px; }
      .paywall-icon { font-size: 4rem; margin-bottom: 16px; }
      .paywall-wrap h2 { font-family: 'Fredoka One', cursive; font-size: 2rem; margin-bottom: 12px; color: #1a1a2e; }
      .paywall-wrap p { color: #636e72; max-width: 480px; margin: 0 auto 28px; font-size: 1.05rem; line-height: 1.6; }
      .paywall-features { list-style: none; padding: 0; margin: 0 auto 32px; max-width: 380px; text-align: left; }
      .paywall-features li { padding: 8px 0; border-bottom: 1px solid #eee; font-size: 0.95rem; color: #444; }
      .paywall-features li::before { content: '✅ '; }
      .paywall-cta { background: linear-gradient(135deg, #4ECDC4, #2D9CDB); color: white; padding: 16px 40px; border-radius: 50px; font-weight: 800; font-size: 1.05rem; text-decoration: none; display: inline-block; transition: transform 0.2s, box-shadow 0.2s; }
      .paywall-cta:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(78,205,196,0.35); }
      .paywall-login { margin-top: 14px; font-size: 0.9rem; color: #888; }
      .paywall-login a { color: #4A90D9; text-decoration: none; }
    </style>
    <div class="paywall-wrap">
      <div class="paywall-icon">🔒</div>
      <h2>Premium Content</h2>
      <p>This section is for KinderLingo subscribers. Get unlimited access to all games, worksheets, lesson plans, and more!</p>
      <ul class="paywall-features">
        <li>200+ printable worksheets & flashcards</li>
        <li>20 complete ESL lesson plans</li>
        <li>All flashcard games — no ads!</li>
        <li>New content added every month</li>
        <li>Downloadable PDFs & PowerPoints</li>
      </ul>
      <a href="/auth-system/signup.html" class="paywall-cta">Start Free Trial →</a>
      <div class="paywall-login">Already subscribed? <a href="/auth-system/login.html">Log in here</a></div>
    </div>
  `;
}

// ── Helpers ─────────────────────────────────

export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function formatDate(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

export function showMessage(msg, type = 'success') {
  const el = document.getElementById('message-area');
  if (!el) return;
  el.innerHTML = `<div class="msg-box msg-${type}">${escapeHtml(msg)}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 6000);
}

// ── Init: update nav on every page load ────

document.addEventListener('DOMContentLoaded', () => {
  updateNavAuthState();
});
