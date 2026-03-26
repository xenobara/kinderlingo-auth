# KinderLingo Auth System — Setup Guide

## Overview

This folder contains the complete authentication and admin dashboard system for KinderLingo:

- **Login/Signup** at `/auth-system/login.html` and `/auth-system/signup.html`
- **Admin Dashboard** at `/auth-system/admin.html`
- **Premium Content Example** at `/auth-system/premium.html`

---

## Step 1: Create a Supabase Project

1. Go to [https://supabase.com](https://supabase.com) and sign up (free tier is fine)
2. Click **New Project**
3. Give it a name like `KinderLingo`
4. Set a strong database password — **save this!**
5. Choose a region closest to your users
6. Wait for the project to be created (~2 minutes)

### Get Your Supabase Credentials

Once created, go to **Settings → API** and copy:
- **Project URL** → `SUPABASE_URL`
- **anon/public key** → `SUPABASE_ANON_KEY` (safe to expose in client-side code)
- **service_role key** → `SUPABASE_SERVICE_KEY` (keep secret — used only in Cloudflare Worker)

---

## Step 2: Set Up the Database Schema

In your Supabase project, go to **SQL Editor** and run this to create the `profiles` table:

```sql
-- Create profiles table (extends auth.users)
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  is_subscriber BOOLEAN DEFAULT FALSE,
  is_admin BOOLEAN DEFAULT FALSE,
  is_suspended BOOLEAN DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Policy: users can view their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Policy: users can update their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Policy: anyone (even anon) can view profiles for the admin dashboard
-- This is protected by the admin flag check in the Worker + client-side admin check
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (is_admin = TRUE);

-- Policy: service role can do anything (for Cloudflare Worker)
-- This is handled by the service_role key bypassing RLS

-- Policy: allow insert from authenticated users (for profile creation)
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);
```

### Create a Trigger to Auto-Create Profile on Signup

```sql
-- Function to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (
    NEW.id,
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger fires when a new user is created in auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

---

## Step 3: Enable Email/Password Auth

In Supabase dashboard:
1. Go to **Authentication → Providers → Email**
2. Enable **Email** provider
3. (Optional) Disable "Confirm email" if you want instant login (not recommended for production)

### Enable Google OAuth (Optional)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new OAuth 2.0 client ID (Web application)
3. Add your domain to Authorized JavaScript origins
4. Add `https://YOUR_PROJECT.supabase.co` to Authorized redirect URIs
5. Copy the Client ID and Secret into Supabase **Authentication → Providers → Google**

---

## Step 4: Set Your Admin User

After signing up with your admin email, go to Supabase **Authentication → Users**:
1. Find your user
2. Click the user row, then in the `profiles` table (via Table Editor), set `is_admin = TRUE`

OR run this SQL (replace with your email):

```sql
UPDATE public.profiles
SET is_admin = TRUE
WHERE email = 'your-admin@email.com';
```

---

## Step 5: Update auth.js with Your Credentials

Edit `auth-system/static/auth.js` and replace the placeholder values at the top:

```javascript
export const SUPABASE_URL = 'https://xxxxx.supabase.co';      // ← your Project URL
export const SUPABASE_ANON_KEY = 'eyJhbGc...';               // ← your anon key
export const ADMIN_EMAIL = 'zac@yourdomain.com';              // ← your admin email
```

---

## Step 6: Set Environment Variables in Cloudflare Pages

In your Cloudflare Pages project (or when creating a new one):

| Variable Name | Value |
|---|---|
| `SUPABASE_URL` | `https://xxxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | `eyJhbGc...` (anon key) |
| `SUPABASE_SERVICE_KEY` | `eyJhbGc...` (service_role key — keep secret!) |
| `ADMIN_EMAIL` | `zac@yourdomain.com` |
| `RESEND_API_KEY` | (optional) Resend API key for welcome emails |

---

## Step 7: Connect GitHub & Deploy to Cloudflare Pages

1. Push this `auth-system/` folder to a GitHub repo (or add to existing)
2. Go to [https://pages.cloudflare.com](https://pages.cloudflare.com)
3. Click **Create a project**
4. Connect your GitHub repo and select the `auth-system/` directory
5. **Build command:** leave empty (static HTML)
6. **Build output directory:** `.`
7. Add the environment variables above
8. Click **Deploy**

Your auth system will be live at:
`https://kinderlingo-auth.pages.dev`

---

## How It Works

### Authentication Flow
1. User signs up/logs in via Supabase Auth (email/password or Google)
2. Supabase returns a JWT stored in `localStorage` by `@supabase/supabase-js`
3. `auth.js` provides `isLoggedIn()`, `isAdmin()`, `isSubscriber()` helpers
4. All pages call `updateNavAuthState()` to update the nav on load

### Admin Dashboard Security
1. Client-side: checks `is_admin` from Supabase profile (anyone can inspect this)
2. Server-side: Cloudflare Worker checks `is_admin` flag + `email === ADMIN_EMAIL` env var
3. Database: RLS policies ensure users can only see/modify their own data
4. Service role key (in Worker only) bypasses RLS for admin operations

### Paywall Flow
1. Premium page calls `isSubscriber()` on load
2. If false → renders paywall CTA via `renderPaywall()`
3. If true → renders actual premium content

### Welcome Emails
1. On successful signup, trigger calls `/api/welcome-email` (optionally)
2. Cloudflare Worker sends email via Resend API
3. If no Resend key set, logs to console (dev mode)

---

## Files Reference

| File | Purpose |
|---|---|
| `login.html` | Combined login/signup page |
| `signup.html` | Dedicated signup page with benefits |
| `logout.html` | Logs out and redirects |
| `admin.html` | Admin dashboard (protected) |
| `premium.html` | Example premium content page |
| `static/auth.js` | Shared Supabase client + auth helpers |
| `functions/api/[[catchall]].js` | Cloudflare Worker (admin API + emails) |
| `wrangler.toml` | Cloudflare Pages config |
| `_headers` | Security headers |

---

## Free Tier Limits (Supabase)

- **50,000 monthly active users** — free
- **100MB database** — enough for user profiles
- **2GB bandwidth** — fine for small usage
- **50 emails/month** — on Resend free tier

---

## Troubleshooting

**"Invalid login credentials"**
→ Make sure user has confirmed their email (check Supabase Authentication → Users)

**Admin dashboard shows "Access Denied"**
→ Make sure `is_admin = TRUE` in the `profiles` table for your user

**Supabase connection errors**
→ Check that your `SUPABASE_URL` and `SUPABASE_ANON_KEY` are correct in `auth.js`

**Cloudflare Worker errors**
→ Check Cloudflare Pages → Functions → Logs for error details
