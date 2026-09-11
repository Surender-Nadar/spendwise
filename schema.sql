-- =====================================================================
-- SpendWise — Supabase schema (individual accounts)
-- =====================================================================
-- HOW TO RUN
-- 1. Open your Supabase project -> SQL Editor -> New query.
-- 2. Paste this whole file and click "Run".
-- 3. If you ran the OLD household-based version of this schema before,
--    run the "DROP OLD OBJECTS" block at the very bottom FIRST, then
--    run everything above it again.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. PROFILES — one row per signed-up user
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'New User',
  salary_target numeric(12,2) not null default 0,
  needs_pct numeric(5,2) not null default 50,
  wants_pct numeric(5,2) not null default 30,
  savings_pct numeric(5,2) not null default 20,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. ACCOUNTS — bank / cash / UPI / savings / credit card / other
-- ---------------------------------------------------------------------
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('bank','cash','upi','savings','credit_card','other')),
  opening_balance numeric(12,2) not null default 0,
  current_balance numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. TRANSACTIONS
-- category examples for expense: Food, Shopping, Travel, Bills, Rent,
-- Health, Entertainment, Education, Other. For income: Salary, Gift,
-- Freelance, Interest, Business, Other. "Dad gave me 5k" -> type
-- income, category 'Gift', credited to whichever account it landed in.
-- ---------------------------------------------------------------------
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  type text not null check (type in ('income','expense')),
  amount numeric(12,2) not null check (amount > 0),
  category text not null,
  description text not null default '',
  date date not null default current_date,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_accounts_user on public.accounts(user_id);
create index if not exists idx_transactions_user on public.transactions(user_id);
create index if not exists idx_transactions_account on public.transactions(account_id);
create index if not exists idx_transactions_date on public.transactions(date);

-- =====================================================================
-- NEW USER TRIGGER — creates the matching profile row automatically
-- whenever someone signs up. Reads `full_name` from the signup metadata.
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- BALANCE MAINTENANCE TRIGGER
-- Keeps accounts.current_balance in sync whenever a transaction is
-- inserted, updated, or deleted. Income adds, expense subtracts.
-- =====================================================================
create or replace function public.apply_transaction_delta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.accounts
      set current_balance = current_balance + (case when new.type = 'income' then new.amount else -new.amount end)
      where id = new.account_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.accounts
      set current_balance = current_balance - (case when old.type = 'income' then old.amount else -old.amount end)
      where id = old.account_id;
    return old;
  elsif tg_op = 'UPDATE' then
    update public.accounts
      set current_balance = current_balance - (case when old.type = 'income' then old.amount else -old.amount end)
      where id = old.account_id;
    update public.accounts
      set current_balance = current_balance + (case when new.type = 'income' then new.amount else -new.amount end)
      where id = new.account_id;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists on_transaction_change on public.transactions;
create trigger on_transaction_change
  after insert or update or delete on public.transactions
  for each row execute function public.apply_transaction_delta();

-- =====================================================================
-- ROW LEVEL SECURITY — every user sees and edits only their own rows
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "profiles select own" on public.profiles;
create policy "profiles select own" on public.profiles
  for select using (id = auth.uid());

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update using (id = auth.uid());

drop policy if exists "accounts select own" on public.accounts;
create policy "accounts select own" on public.accounts
  for select using (user_id = auth.uid());

drop policy if exists "accounts insert own" on public.accounts;
create policy "accounts insert own" on public.accounts
  for insert with check (user_id = auth.uid());

drop policy if exists "accounts update own" on public.accounts;
create policy "accounts update own" on public.accounts
  for update using (user_id = auth.uid());

drop policy if exists "accounts delete own" on public.accounts;
create policy "accounts delete own" on public.accounts
  for delete using (user_id = auth.uid());

drop policy if exists "transactions select own" on public.transactions;
create policy "transactions select own" on public.transactions
  for select using (user_id = auth.uid());

drop policy if exists "transactions insert own" on public.transactions;
create policy "transactions insert own" on public.transactions
  for insert with check (user_id = auth.uid());

drop policy if exists "transactions update own" on public.transactions;
create policy "transactions update own" on public.transactions
  for update using (user_id = auth.uid());

drop policy if exists "transactions delete own" on public.transactions;
create policy "transactions delete own" on public.transactions
  for delete using (user_id = auth.uid());

-- =====================================================================
-- DROP OLD OBJECTS (only run this if you previously set up the
-- household/family version of this schema — run it FIRST, then run
-- everything above again)
-- =====================================================================
-- drop trigger if exists on_transaction_change on public.transactions;
-- drop trigger if exists on_auth_user_created on auth.users;
-- drop table if exists public.transactions cascade;
-- drop table if exists public.accounts cascade;
-- drop table if exists public.profiles cascade;
-- drop table if exists public.households cascade;
-- drop function if exists public.apply_transaction_delta();
-- drop function if exists public.handle_new_user();
-- drop function if exists public.current_household_id();
-- drop function if exists public.current_role();
-- drop function if exists public.gen_invite_code();
