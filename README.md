# SpendWise

A private finance dashboard — income, expenses, multiple accounts, budgets
and spending insights, backed by Supabase. Pure HTML/CSS/JS, no build step,
so it deploys straight to GitHub Pages. Every user who signs up gets their
own private data — nothing is shared between accounts.

## 1. Set up Supabase

1. Go to [supabase.com](https://supabase.com) → your project (or create a new one).
2. Open **SQL Editor** → **New query**, paste the entire contents of
   [`schema.sql`](./schema.sql), and click **Run**.
   - This creates `profiles`, `accounts`, `transactions`, a trigger that
     auto-creates a profile whenever someone signs up, a trigger that keeps
     account balances in sync automatically, and Row Level Security so
     every user can only ever see or change their own rows.
   - If you previously set up the earlier "family/household" version of
     this schema, run the commented-out `DROP OLD OBJECTS` block at the
     bottom of the file first, then run the rest again.
3. Go to **Authentication → Providers → Email** and decide whether to require
   email confirmation:
   - **Off**: users can sign in right after signing up.
   - **On**: users must click a confirmation link first — the app already
     shows a "check your inbox" message when this is enabled.
4. Go to **Project Settings → API** and copy:
   - **Project URL**
   - **anon public** key

## 2. Connect the app to your project

Open [`config.js`](./config.js) and paste in the two values:

```js
export const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

That's the only code change required to get the app talking to your database.

## 3. Try it locally (optional)

Any static file server works, e.g.:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open the printed URL in your browser.

## 4. Deploy to GitHub Pages

1. Create a new GitHub repo and push this folder to it.
2. In the repo: **Settings → Pages → Build and deployment → Source** →
   "Deploy from a branch".
3. Pick your default branch (e.g. `main`) and `/ (root)` as the folder.
4. Save — GitHub gives you a URL like `https://yourname.github.io/spendwise/`
   within a minute or two.

That's it — no build tools, no `npm install`. It's plain HTML/CSS/JS that
imports the Supabase client straight from a CDN.

## 5. How accounts work

- Anyone can sign up with email + password. Signing up creates their own
  private profile, accounts and transactions — invisible to every other
  user, enforced at the database level by Row Level Security.
- You and your sister would each create your own account and log your own
  spending separately — everyone gets their own copy of the app with its
  own data, not a shared ledger.
- Every returning user sees **"Welcome back, {name}"** when they open the
  app (their session is restored automatically by Supabase Auth); a brand
  new signup sees a first-time welcome message instead.
- Money someone gives you — "Dad gave me ₹5,000" — is just an **income**
  transaction with category **Gift**, credited to whichever account it
  landed in. It flows straight into your balances and insights, no
  separate feature needed.

## 6. What's in the app

- **Auth** — email/password sign up & sign in via Supabase Auth, session
  persistence with a "welcome back" greeting, sign out, optional email
  confirmation.
- **Dashboard** — total balance, monthly income/spend/savings, a 6-month
  cash-flow chart, a "where your money goes" category breakdown, recent
  transactions, account overview.
- **Transactions** — add/edit/delete income or expense entries (amount,
  category, description, date, notes, account); search + filter by type,
  category, account, month.
- **Accounts** — bank/cash/UPI/savings/credit card/other, each with an
  opening balance that updates automatically as you log transactions; edit
  and delete.
- **Insights** — average daily spend, largest expense, top category,
  savings rate, month-over-month trend, category and 6-month trend charts,
  and a needs/wants/savings budget bar comparing target vs. actual.
- **Settings** — profile name, salary target and needs/wants/savings split,
  export everything as a JSON backup, delete all transactions.

## 7. Notes on security

Row Level Security is enabled on every table, scoped to each individual
user — even with the `anon` key exposed in the frontend (normal for
Supabase client-side apps), no one can read or write another user's data.
Never expose your **service role** key in this app; only the **anon
public** key belongs in `config.js`.
