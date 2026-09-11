import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------
const EXPENSE_CATEGORIES = ["Food", "Shopping", "Travel", "Bills", "Rent", "Health", "Entertainment", "Education", "Other"];
const INCOME_CATEGORIES = ["Salary", "Gift", "Freelance", "Interest", "Business", "Other"];
const CATEGORY_ICON = {
  Food: "🍽️", Shopping: "🛍️", Travel: "✈️", Bills: "🧾", Rent: "🏠",
  Health: "💊", Entertainment: "🎬", Education: "📚", Salary: "💼",
  Gift: "🎁", Freelance: "💻", Interest: "🏦", Business: "📈", Other: "•",
};
const ACCOUNT_TYPE_LABEL = { bank: "Bank", cash: "Cash", upi: "UPI", savings: "Savings", credit_card: "Credit card", other: "Other" };
const MONTH_FMT = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" });
const currency = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const currencyPrecise = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------
const state = {
  user: null,
  profile: null,
  accounts: [],
  transactions: [],
  charts: {},
  editingTxId: null,
  editingAccId: null,
  currentType: "expense",
  isNewSignup: false,
};

// ---------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const on = (el, evt, fn) => el && el.addEventListener(evt, fn);

function toast(message, kind = "default") {
  const stack = $("#toast-stack");
  const t = document.createElement("div");
  t.className = "toast" + (kind === "error" ? " toast-error" : kind === "success" ? " toast-success" : "");
  t.textContent = message;
  stack.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

function friendlyError(err) {
  const msg = (err && err.message) || String(err);
  if (/Invalid login credentials/i.test(msg)) return "That email or password doesn't match our records.";
  if (/User already registered/i.test(msg)) return "An account with this email already exists — try signing in instead.";
  if (/Email not confirmed/i.test(msg)) return "Please confirm your email first — check your inbox for the confirmation link.";
  if (/network/i.test(msg) || /fetch/i.test(msg)) return "Can't reach Supabase — check your internet connection and the URL/key in config.js.";
  return msg;
}

// =====================================================================
// AUTH
// =====================================================================
function initAuthScreen() {
  $$(".auth-tab").forEach((tab) => on(tab, "click", () => {
    $$(".auth-tab").forEach((t) => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    const isSignin = tab.dataset.tab === "signin";
    $("#signin-form").classList.toggle("is-hidden", !isSignin);
    $("#signup-form").classList.toggle("is-hidden", isSignin);
    $("#confirm-email-note").textContent = "";
  }));

  on($("#signin-form"), "submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const form = new FormData(e.target);
    const errEl = $("#signin-error");
    errEl.textContent = "";
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: form.get("email").trim(), password: form.get("password") });
    btn.disabled = false;
    if (error) { errEl.textContent = friendlyError(error); return; }
    // onAuthStateChange picks it up and loads the app
  });

  on($("#signup-form"), "submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const form = new FormData(e.target);
    const errEl = $("#signup-error");
    errEl.textContent = "";

    btn.disabled = true;
    const { data, error } = await sb.auth.signUp({
      email: form.get("email").trim(),
      password: form.get("password"),
      options: { data: { full_name: form.get("full_name").trim() } },
    });
    btn.disabled = false;
    if (error) { errEl.textContent = friendlyError(error); return; }

    if (data.session) {
      // email confirmation is off — user is logged in immediately
      state.isNewSignup = true;
      return;
    }
    $("#confirm-email-note").textContent = "Check your inbox — confirm your email, then sign in.";
    e.target.reset();
  });
}

on(document, "DOMContentLoaded", () => {
  initAuthScreen();
  initNav();
  initModals();
  initDashboardLinks();
  initTransactionForm();
  initAccountForm();
  initSettingsForms();
  initFilters();
  initDataActions();

  sb.auth.onAuthStateChange(async (event, session) => {
    if (session && session.user) {
      state.user = session.user;
      await bootstrapApp();
    } else {
      state.user = null;
      showAuthScreen();
    }
  });
});

function showAuthScreen() {
  $("#auth-screen").classList.remove("is-hidden");
  $("#app-shell").classList.add("is-hidden");
}

async function bootstrapApp() {
  try {
    await loadProfile();
    await Promise.all([loadAccounts(), loadTransactions()]);
    $("#auth-screen").classList.add("is-hidden");
    $("#app-shell").classList.remove("is-hidden");
    populateFilterOptions();
    populateCategoryOptions();
    renderEverything();
    showGreeting();
  } catch (err) {
    console.error(err);
    toast(friendlyError(err), "error");
  }
}

function showGreeting() {
  const name = (state.profile.full_name || "there").split(" ")[0];
  if (state.isNewSignup) {
    toast(`Welcome, ${name}! Your account is ready — add an account to start logging.`, "success");
    $("#page-greeting").textContent = `Welcome, ${name} 👋`;
    state.isNewSignup = false;
  } else {
    toast(`Welcome back, ${name}!`, "success");
    $("#page-greeting").textContent = `Welcome back, ${name} 👋`;
  }
}

on($("#signout-btn"), "click", async () => {
  await sb.auth.signOut();
});

// =====================================================================
// DATA LOADING
// =====================================================================
async function loadProfile() {
  const { data: profile, error } = await sb.from("profiles").select("*").eq("id", state.user.id).single();
  if (error) throw error;
  state.profile = profile;

  $("#who-initial").textContent = (profile.full_name || "?").trim().charAt(0).toUpperCase();
  $("#who-name").textContent = profile.full_name;
}

async function loadAccounts() {
  const { data, error } = await sb.from("accounts").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  state.accounts = data || [];
}

async function loadTransactions() {
  const { data, error } = await sb.from("transactions").select("*").order("date", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  state.transactions = data || [];
}

function renderEverything() {
  renderDashboard();
  renderTransactionsList();
  renderAccountsGrid();
  renderInsights();
  renderSettings();
}

// =====================================================================
// NAVIGATION
// =====================================================================
function initNav() {
  $$(".nav-item[data-view]").forEach((btn) => on(btn, "click", () => switchView(btn.dataset.view)));
}
function initDashboardLinks() {
  $$("[data-view-link]").forEach((btn) => on(btn, "click", () => switchView(btn.dataset.viewLink)));
}
function switchView(view) {
  $$(".view").forEach((v) => v.classList.remove("is-active"));
  $(`#view-${view}`)?.classList.add("is-active");
  $$(".nav-item[data-view]").forEach((b) => b.classList.toggle("is-active", b.dataset.view === view));
  const titles = { dashboard: "Dashboard", transactions: "Transactions", accounts: "Accounts", insights: "Insights", settings: "Settings" };
  $("#page-title").textContent = titles[view] || "SpendWise";
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

// =====================================================================
// MODALS
// =====================================================================
function initModals() {
  on($("#modal-backdrop"), "click", (e) => { if (e.target === $("#modal-backdrop")) closeModals(); });
  $$("[data-close-modal]").forEach((btn) => on(btn, "click", closeModals));
  on(document, "keydown", (e) => { if (e.key === "Escape") closeModals(); });
}
function openModal(id) {
  $("#modal-backdrop").classList.remove("is-hidden");
  $$(".modal").forEach((m) => m.classList.remove("is-open"));
  $(`#${id}`).classList.add("is-open");
}
function closeModals() {
  $("#modal-backdrop").classList.add("is-hidden");
  $$(".modal").forEach((m) => m.classList.remove("is-open"));
}

let confirmCallback = null;
function askConfirm(title, body, onConfirm) {
  $("#confirm-title").textContent = title;
  $("#confirm-body").textContent = body;
  confirmCallback = onConfirm;
  openModal("modal-confirm");
}
on($("#confirm-ok-btn"), "click", async () => {
  const cb = confirmCallback;
  closeModals();
  if (cb) await cb();
});

// =====================================================================
// TRANSACTIONS — form, categories, filters, list rendering
// =====================================================================
function populateCategoryOptions() {
  const sel = $("#tx-category");
  const list = state.currentType === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  sel.innerHTML = list.map((c) => `<option value="${c}">${c}</option>`).join("");
}
function populateAccountSelect(selectEl, includeAll = false) {
  const opts = state.accounts.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");
  selectEl.innerHTML = (includeAll ? '<option value="">All accounts</option>' : "") + opts;
}

on($("#add-transaction-btn"), "click", () => openTransactionModal());

function openTransactionModal(tx = null) {
  state.editingTxId = tx ? tx.id : null;
  $("#tx-modal-title").textContent = tx ? "Edit transaction" : "Add transaction";
  state.currentType = tx ? tx.type : "expense";
  $$(".type-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.type === state.currentType));
  populateCategoryOptions();
  populateAccountSelect($("#tx-account"));
  $("#tx-error").textContent = "";

  if (state.accounts.length === 0) {
    $("#tx-error").textContent = "Add an account first, then log a transaction against it.";
  }

  $("#tx-amount").value = tx ? tx.amount : "";
  $("#tx-date").value = tx ? tx.date : new Date().toISOString().slice(0, 10);
  $("#tx-description").value = tx ? tx.description : "";
  $("#tx-notes").value = tx ? tx.notes : "";
  if (tx) {
    populateCategoryOptions();
    $("#tx-category").value = tx.category;
    $("#tx-account").value = tx.account_id;
  }
  openModal("modal-transaction");
}

$$(".type-btn").forEach((btn) => on(btn, "click", () => {
  $$(".type-btn").forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");
  state.currentType = btn.dataset.type;
  populateCategoryOptions();
}));

function initTransactionForm() {
  on($("#transaction-form"), "submit", async (e) => {
    e.preventDefault();
    const errEl = $("#tx-error");
    errEl.textContent = "";

    if (state.accounts.length === 0) { errEl.textContent = "You need at least one account before logging a transaction."; return; }

    const amount = parseFloat($("#tx-amount").value);
    if (!amount || amount <= 0) { errEl.textContent = "Enter an amount greater than zero."; return; }

    const payload = {
      user_id: state.user.id,
      account_id: $("#tx-account").value,
      type: state.currentType,
      amount,
      category: $("#tx-category").value,
      description: $("#tx-description").value.trim(),
      date: $("#tx-date").value,
      notes: $("#tx-notes").value.trim(),
    };
    if (!payload.description) { errEl.textContent = "Add a short description so you remember what this was."; return; }
    if (!payload.date) { errEl.textContent = "Pick a date."; return; }

    const btn = e.submitter;
    btn.disabled = true;
    let error;
    if (state.editingTxId) {
      ({ error } = await sb.from("transactions").update(payload).eq("id", state.editingTxId));
    } else {
      ({ error } = await sb.from("transactions").insert(payload));
    }
    btn.disabled = false;

    if (error) { errEl.textContent = friendlyError(error); return; }
    closeModals();
    toast(state.editingTxId ? "Transaction updated." : "Transaction added.", "success");
    await Promise.all([loadAccounts(), loadTransactions()]);
    renderEverything();
  });
}

function initFilters() {
  ["filter-search", "filter-type", "filter-category", "filter-account", "filter-month"].forEach((id) => {
    on($(`#${id}`), "input", renderTransactionsList);
    on($(`#${id}`), "change", renderTransactionsList);
  });
  on($("#filter-reset"), "click", () => {
    $("#filter-search").value = "";
    $("#filter-type").value = "";
    $("#filter-category").value = "";
    $("#filter-account").value = "";
    $("#filter-month").value = "";
    renderTransactionsList();
  });
}
function populateFilterOptions() {
  const catSel = $("#filter-category");
  const allCats = [...new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])];
  catSel.innerHTML = '<option value="">All categories</option>' + allCats.map((c) => `<option value="${c}">${c}</option>`).join("");
  populateAccountSelect($("#filter-account"), true);
}

function getFilteredTransactions() {
  const search = $("#filter-search")?.value.trim().toLowerCase() || "";
  const type = $("#filter-type")?.value || "";
  const category = $("#filter-category")?.value || "";
  const account = $("#filter-account")?.value || "";
  const month = $("#filter-month")?.value || "";

  return state.transactions.filter((t) => {
    if (type && t.type !== type) return false;
    if (category && t.category !== category) return false;
    if (account && t.account_id !== account) return false;
    if (month && t.date.slice(0, 7) !== month) return false;
    if (search && !(t.description.toLowerCase().includes(search) || (t.notes || "").toLowerCase().includes(search))) return false;
    return true;
  });
}

function accountName(id) { return state.accounts.find((a) => a.id === id)?.name || "Unknown account"; }

function ledgerRowHtml(t) {
  const sign = t.type === "income" ? "+" : "−";
  const tone = t.type === "income" ? "tone-income" : "tone-expense";
  return `
    <div class="ledger-row" data-tx-id="${t.id}">
      <div class="ledger-icon">${CATEGORY_ICON[t.category] || "•"}</div>
      <div class="ledger-main">
        <div class="ledger-desc">${escapeHtml(t.description)}</div>
        <div class="ledger-meta">${t.category} · ${accountName(t.account_id)} · ${formatDate(t.date)}</div>
      </div>
      <div class="ledger-amount ${tone}">${sign}${currency(t.amount)}</div>
      <button class="ledger-del" data-del-tx="${t.id}" title="Delete" aria-label="Delete transaction">🗑</button>
    </div>`;
}

function formatDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function renderTransactionsList() {
  const filtered = getFilteredTransactions();
  const container = $("#transactions-ledger");
  $("#transactions-count").textContent = `${filtered.length} transaction${filtered.length === 1 ? "" : "s"}`;
  container.innerHTML = filtered.length
    ? filtered.map(ledgerRowHtml).join("")
    : `<div class="ledger-empty">No transactions match these filters yet. Log one with "+ Add transaction".</div>`;
  wireDeleteButtons(container);
}

function wireDeleteButtons(root) {
  $$("[data-del-tx]", root).forEach((btn) => on(btn, "click", () => {
    const id = btn.dataset.delTx;
    askConfirm("Delete transaction?", "This removes it permanently and adjusts the account balance.", async () => {
      const { error } = await sb.from("transactions").delete().eq("id", id);
      if (error) { toast(friendlyError(error), "error"); return; }
      toast("Transaction deleted.", "success");
      await Promise.all([loadAccounts(), loadTransactions()]);
      renderEverything();
    });
  }));
}

// =====================================================================
// ACCOUNTS
// =====================================================================
on($("#add-account-btn"), "click", () => openAccountModal());

function openAccountModal(acc = null) {
  state.editingAccId = acc ? acc.id : null;
  $("#acc-modal-title").textContent = acc ? "Edit account" : "Add account";
  $("#acc-name").value = acc ? acc.name : "";
  $("#acc-type").value = acc ? acc.type : "bank";
  $("#acc-opening").value = acc ? acc.opening_balance : "0";
  $("#acc-opening").disabled = !!acc; // opening balance fixed after creation to keep balances consistent
  $("#acc-error").textContent = "";
  openModal("modal-account");
}

function initAccountForm() {
  on($("#account-form"), "submit", async (e) => {
    e.preventDefault();
    const errEl = $("#acc-error");
    errEl.textContent = "";
    const name = $("#acc-name").value.trim();
    if (!name) { errEl.textContent = "Give the account a name."; return; }
    const opening = parseFloat($("#acc-opening").value) || 0;

    const btn = e.submitter;
    btn.disabled = true;
    let error;
    if (state.editingAccId) {
      ({ error } = await sb.from("accounts").update({ name, type: $("#acc-type").value }).eq("id", state.editingAccId));
    } else {
      ({ error } = await sb.from("accounts").insert({
        user_id: state.user.id,
        name,
        type: $("#acc-type").value,
        opening_balance: opening,
        current_balance: opening,
      }));
    }
    btn.disabled = false;
    if (error) { errEl.textContent = friendlyError(error); return; }
    closeModals();
    toast(state.editingAccId ? "Account updated." : "Account added.", "success");
    await loadAccounts();
    renderEverything();
    populateFilterOptions();
  });
}

function renderAccountsGrid() {
  const grid = $("#accounts-grid");
  if (state.accounts.length === 0) {
    grid.innerHTML = `<div class="empty-note">No accounts yet — add your bank, cash or UPI wallet to start logging transactions.</div>`;
    return;
  }
  grid.innerHTML = state.accounts.map((a) => `
    <div class="account-card">
      <div class="account-card-head">
        <div>
          <div class="account-card-name">${escapeHtml(a.name)}</div>
          <div class="account-card-type">${ACCOUNT_TYPE_LABEL[a.type] || a.type}</div>
        </div>
        <span class="acc-tag">${ACCOUNT_TYPE_LABEL[a.type] || a.type}</span>
      </div>
      <div class="account-card-balance">${currency(a.current_balance)}</div>
      <div class="account-card-open">Opening balance ${currency(a.opening_balance)}</div>
      <div class="account-card-actions">
        <button class="btn btn-ghost" data-edit-acc="${a.id}">Edit</button>
        <button class="btn btn-danger" data-del-acc="${a.id}">Delete</button>
      </div>
    </div>`).join("");

  $$("[data-edit-acc]", grid).forEach((btn) => on(btn, "click", () => {
    const acc = state.accounts.find((a) => a.id === btn.dataset.editAcc);
    openAccountModal(acc);
  }));
  $$("[data-del-acc]", grid).forEach((btn) => on(btn, "click", () => {
    const id = btn.dataset.delAcc;
    const hasTx = state.transactions.some((t) => t.account_id === id);
    askConfirm(
      "Delete account?",
      hasTx ? "This account has transactions logged against it — deleting it removes those transactions too. This can't be undone."
            : "This can't be undone.",
      async () => {
        const { error } = await sb.from("accounts").delete().eq("id", id);
        if (error) { toast(friendlyError(error), "error"); return; }
        toast("Account deleted.", "success");
        await Promise.all([loadAccounts(), loadTransactions()]);
        renderEverything();
        populateFilterOptions();
      }
    );
  }));

  // dashboard overview mini-list
  const overview = $("#account-overview");
  overview.innerHTML = state.accounts.length
    ? state.accounts.map((a) => `
      <div class="acc-row">
        <div class="acc-row-left"><span class="acc-tag">${ACCOUNT_TYPE_LABEL[a.type] || a.type}</span><span>${escapeHtml(a.name)}</span></div>
        <span class="acc-bal">${currency(a.current_balance)}</span>
      </div>`).join("")
    : `<div class="empty-note">No accounts yet.</div>`;
}

// =====================================================================
// DASHBOARD
// =====================================================================
function monthKey(d) { return d.toISOString().slice(0, 7); }
function thisMonthKey() { return monthKey(new Date()); }

function renderDashboard() {
  const totalBalance = state.accounts.reduce((sum, a) => sum + Number(a.current_balance), 0);
  $("#kpi-total-balance").textContent = currency(totalBalance);

  const mKey = thisMonthKey();
  const thisMonthTx = state.transactions.filter((t) => t.date.slice(0, 7) === mKey);
  const income = thisMonthTx.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
  const expense = thisMonthTx.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  $("#kpi-income").textContent = currency(income);
  $("#kpi-expense").textContent = currency(expense);
  $("#kpi-savings").textContent = currency(income - expense);

  renderCashflowChart();
  renderBreakdownChart(thisMonthTx);

  $("#recent-transactions").innerHTML = state.transactions.length
    ? state.transactions.slice(0, 6).map(ledgerRowHtml).join("")
    : `<div class="ledger-empty">Nothing logged yet — add your first transaction.</div>`;
  wireDeleteButtons($("#recent-transactions"));
}

function lastNMonths(n) {
  const months = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d);
  }
  return months;
}

function renderCashflowChart() {
  const months = lastNMonths(6);
  const labels = months.map((d) => MONTH_FMT.format(d));
  const incomeData = months.map((d) => sumForMonth(d, "income"));
  const expenseData = months.map((d) => sumForMonth(d, "expense"));

  destroyChart("cashflow");
  state.charts.cashflow = new Chart($("#chart-cashflow"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Income", data: incomeData, backgroundColor: "#2F6F5E", borderRadius: 4, maxBarThickness: 28 },
        { label: "Expense", data: expenseData, backgroundColor: "#9C4A2E", borderRadius: 4, maxBarThickness: 28 },
      ],
    },
    options: chartBaseOptions({ stacked: false }),
  });
}

function sumForMonth(dateObj, type) {
  const key = monthKey(dateObj);
  return state.transactions.filter((t) => t.type === type && t.date.slice(0, 7) === key).reduce((s, t) => s + Number(t.amount), 0);
}

function renderBreakdownChart(monthTx) {
  const expenses = monthTx.filter((t) => t.type === "expense");
  const byCat = groupSum(expenses);
  const empty = $("#breakdown-empty");
  const canvas = $("#chart-breakdown");
  destroyChart("breakdown");
  if (Object.keys(byCat).length === 0) {
    empty.classList.remove("is-hidden");
    canvas.classList.add("is-hidden");
    return;
  }
  empty.classList.add("is-hidden");
  canvas.classList.remove("is-hidden");
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  state.charts.breakdown = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: entries.map((e) => e[0]),
      datasets: [{ data: entries.map((e) => e[1]), backgroundColor: paletteFor(entries.length), borderWidth: 2, borderColor: "#FFFFFF" }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } } },
  });
}

function groupSum(txs) {
  const out = {};
  txs.forEach((t) => { out[t.category] = (out[t.category] || 0) + Number(t.amount); });
  return out;
}
function paletteFor(n) {
  const base = ["#2F6F5E", "#B8863B", "#9C4A2E", "#5A7DA3", "#7C6A9C", "#C97A9C", "#4F8F76", "#A3833A"];
  return Array.from({ length: n }, (_, i) => base[i % base.length]);
}
function chartBaseOptions(extra = {}) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      y: { grid: { color: "#EEF1EA" }, ticks: { font: { size: 11 }, callback: (v) => "₹" + v } },
    },
    ...extra,
  };
}
function destroyChart(key) { if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; } }

// =====================================================================
// INSIGHTS
// =====================================================================
function renderInsights() {
  const mKey = thisMonthKey();
  const thisMonthExpenses = state.transactions.filter((t) => t.type === "expense" && t.date.slice(0, 7) === mKey);
  const thisMonthIncome = state.transactions.filter((t) => t.type === "income" && t.date.slice(0, 7) === mKey).reduce((s, t) => s + Number(t.amount), 0);
  const totalExpense = thisMonthExpenses.reduce((s, t) => s + Number(t.amount), 0);

  const daysSoFar = new Date().getDate();
  $("#ins-avg-daily").textContent = currency(totalExpense / daysSoFar);

  const largest = thisMonthExpenses.reduce((max, t) => (Number(t.amount) > Number(max?.amount || 0) ? t : max), null);
  $("#ins-largest").textContent = largest ? currency(largest.amount) : "₹0";

  const byCat = groupSum(thisMonthExpenses);
  const topCat = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
  $("#ins-top-category").textContent = topCat ? topCat[0] : "—";

  const savingsRate = thisMonthIncome > 0 ? ((thisMonthIncome - totalExpense) / thisMonthIncome) * 100 : 0;
  $("#ins-savings-rate").textContent = `${savingsRate.toFixed(0)}%`;

  const lastMonthDate = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const lastMonthExpense = sumForMonth(lastMonthDate, "expense");
  const trendEl = $("#ins-trend");
  if (lastMonthExpense === 0) {
    trendEl.textContent = "—";
  } else {
    const diff = ((totalExpense - lastMonthExpense) / lastMonthExpense) * 100;
    trendEl.textContent = `${diff >= 0 ? "▲" : "▼"} ${Math.abs(diff).toFixed(0)}%`;
    trendEl.className = "kpi-value " + (diff >= 0 ? "tone-expense" : "tone-income");
  }

  // category bar chart
  destroyChart("category");
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  state.charts.category = new Chart($("#chart-category"), {
    type: "bar",
    data: { labels: entries.map((e) => e[0]), datasets: [{ data: entries.map((e) => e[1]), backgroundColor: paletteFor(entries.length), borderRadius: 4 }] },
    options: { ...chartBaseOptions(), indexAxis: "y", plugins: { legend: { display: false } } },
  });

  // 6-month trend line
  const months = lastNMonths(6);
  destroyChart("trend");
  state.charts.trend = new Chart($("#chart-trend"), {
    type: "line",
    data: {
      labels: months.map((d) => MONTH_FMT.format(d)),
      datasets: [{ label: "Spending", data: months.map((d) => sumForMonth(d, "expense")), borderColor: "#9C4A2E", backgroundColor: "rgba(156,74,46,0.12)", fill: true, tension: 0.35 }],
    },
    options: chartBaseOptions({ plugins: { legend: { display: false } } }),
  });

  renderBudgetBars(thisMonthIncome, byCat, totalExpense);
}

function renderBudgetBars(monthIncome, byCat, totalExpense) {
  const salary = Number(state.profile.salary_target) || 0;
  const basis = salary > 0 ? salary : monthIncome;
  const container = $("#budget-bars");
  if (!basis) {
    container.innerHTML = `<p class="empty-note">Add income or a salary target to see your budget split.</p>`;
    return;
  }
  const needsBudget = (basis * state.profile.needs_pct) / 100;
  const wantsBudget = (basis * state.profile.wants_pct) / 100;
  const savingsBudget = (basis * state.profile.savings_pct) / 100;

  const NEEDS_CATS = new Set(["Bills", "Rent", "Health", "Education"]);
  const WANTS_CATS = new Set(["Food", "Shopping", "Travel", "Entertainment", "Other"]);
  let needsSpent = 0, wantsSpent = 0;
  Object.entries(byCat).forEach(([cat, amt]) => { if (NEEDS_CATS.has(cat)) needsSpent += amt; else wantsSpent += amt; });
  const savedSoFar = Math.max(monthIncome - totalExpense, 0);

  const rows = [
    { label: "Needs", spent: needsSpent, budget: needsBudget, color: "var(--gold)" },
    { label: "Wants", spent: wantsSpent, budget: wantsBudget, color: "var(--rust)" },
    { label: "Savings", spent: savedSoFar, budget: savingsBudget, color: "var(--teal)" },
  ];

  container.innerHTML = rows.map((r) => {
    const pct = r.budget > 0 ? Math.min((r.spent / r.budget) * 100, 100) : 0;
    return `
      <div class="budget-bar-row">
        <div class="budget-bar-labels"><span>${r.label}</span><span>${currency(r.spent)} of ${currency(r.budget)}</span></div>
        <div class="budget-bar-track"><div class="budget-bar-fill" style="width:${pct}%;background:${r.color}"></div></div>
      </div>`;
  }).join("");
}

// =====================================================================
// SETTINGS
// =====================================================================
function renderSettings() {
  $("#settings-name").value = state.profile.full_name || "";
  $("#settings-salary").value = state.profile.salary_target;
  $("#settings-needs").value = state.profile.needs_pct;
  $("#settings-wants").value = state.profile.wants_pct;
  $("#settings-savings").value = state.profile.savings_pct;
  updateBudgetTotalNote();
}
function updateBudgetTotalNote() {
  const needs = parseFloat($("#settings-needs").value) || 0;
  const wants = parseFloat($("#settings-wants").value) || 0;
  const savings = parseFloat($("#settings-savings").value) || 0;
  const total = needs + wants + savings;
  const note = $("#budget-total-note");
  note.textContent = `Total: ${total}%${total !== 100 ? " — ideally this adds up to 100%" : " ✓"}`;
}

function initSettingsForms() {
  ["settings-needs", "settings-wants", "settings-savings"].forEach((id) => on($(`#${id}`), "input", updateBudgetTotalNote));

  on($("#profile-form"), "submit", async (e) => {
    e.preventDefault();
    const errEl = $("#profile-error");
    errEl.textContent = "";
    const name = $("#settings-name").value.trim();
    if (!name) { errEl.textContent = "Name can't be empty."; return; }
    const { error } = await sb.from("profiles").update({ full_name: name }).eq("id", state.user.id);
    if (error) { errEl.textContent = friendlyError(error); return; }
    state.profile.full_name = name;
    $("#who-name").textContent = name;
    toast("Profile saved.", "success");
  });

  on($("#budget-form"), "submit", async (e) => {
    e.preventDefault();
    const errEl = $("#budget-error");
    errEl.textContent = "";
    const salary = parseFloat($("#settings-salary").value) || 0;
    const needs = parseFloat($("#settings-needs").value) || 0;
    const wants = parseFloat($("#settings-wants").value) || 0;
    const savings = parseFloat($("#settings-savings").value) || 0;
    if (needs + wants + savings !== 100) { errEl.textContent = "Needs + Wants + Savings should add up to 100%."; return; }

    const { error } = await sb.from("profiles").update({ salary_target: salary, needs_pct: needs, wants_pct: wants, savings_pct: savings }).eq("id", state.user.id);
    if (error) { errEl.textContent = friendlyError(error); return; }
    Object.assign(state.profile, { salary_target: salary, needs_pct: needs, wants_pct: wants, savings_pct: savings });
    toast("Budget allocation saved.", "success");
    renderInsights();
  });
}

function initDataActions() {
  on($("#export-json-btn"), "click", () => {
    const payload = {
      exported_at: new Date().toISOString(),
      profile: state.profile,
      accounts: state.accounts,
      transactions: state.transactions,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spendwise-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Backup downloaded.", "success");
  });

  on($("#delete-all-btn"), "click", () => {
    askConfirm(
      "Delete all transactions?",
      "This removes every transaction you've logged and resets account balances to their opening balance. This can't be undone.",
      async () => {
        const ids = state.transactions.map((t) => t.id);
        if (ids.length === 0) { toast("Nothing to delete."); return; }
        const { error } = await sb.from("transactions").delete().in("id", ids);
        if (error) { toast(friendlyError(error), "error"); return; }
        toast("All transactions deleted.", "success");
        await Promise.all([loadAccounts(), loadTransactions()]);
        renderEverything();
      }
    );
  });
}
