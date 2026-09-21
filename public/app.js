const flash = document.getElementById("flash");
const accountsBody = document.getElementById("accounts");
const logsEl = document.getElementById("logs");
const logsPageEl = document.getElementById("logs-page");
const logsPrev = document.getElementById("logs-prev");
const logsNext = document.getElementById("logs-next");
const LOG_PAGE_SIZE = 20;
let logPage = 1;
let logRefreshSeq = 0;

async function api(path) {
  const response = await fetch(path);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || body.error || response.statusText);
  }
  return body;
}

function showError(error) {
  flash.hidden = false;
  flash.textContent = error instanceof Error ? error.message : String(error);
}

function formatAccountIndex(index) {
  if (index === null || index === undefined) {
    return "";
  }
  return `#${index}`;
}

function formatLogParties(entry) {
  const from = formatAccountIndex(entry.fromIndex);
  const to = formatAccountIndex(entry.toIndex);
  if (from && to) {
    return `${from} → ${to}`;
  }
  return from || to;
}

function formatLogLine(entry) {
  const parties = formatLogParties(entry);
  const tx = entry.txId ? ` ${entry.txId}` : "";
  const error = entry.error ? ` — ${entry.error}` : "";
  const partiesPart = parties ? ` ${parties}` : "";
  return `${entry.at} [${entry.kind}]${partiesPart} ${entry.message}${tx}${error}`;
}

function formatInterval(minutes) {
  if (minutes === null || minutes === undefined || minutes === "") {
    return "—";
  }
  return `Every ${minutes} min`;
}

function renderLogs(logs) {
  logPage = logs.page;
  logsPageEl.textContent = `Page ${logs.page} of ${logs.pageCount} (${logs.total})`;
  logsPrev.disabled = logs.page <= 1;
  logsNext.disabled = logs.page >= logs.pageCount;
  logsEl.innerHTML = "";
  for (const entry of logs.items) {
    const item = document.createElement("li");
    item.textContent = formatLogLine(entry);
    logsEl.appendChild(item);
  }
}

function render(state) {
  document.getElementById("status").textContent = state.status;
  document.getElementById("interval").textContent = formatInterval(
    state.intervalMinutes,
  );
  document.getElementById("tx-count").textContent = state.transactionCount;
  document.getElementById("volume").textContent = state.totalVolumeXlm;
  document.getElementById("protocol-fee").textContent =
    state.protocolFeeXlm ?? "—";
  accountsBody.innerHTML = "";
  for (const account of state.accounts) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${account.index}</td>
      <td>${account.publicKey}</td>
      <td>${account.privateBalanceXlm}</td>
      <td>${account.sentCount}</td>
      <td>${account.sentVolumeXlm}</td>
      <td>${account.funded ? "funded" : ""} ${account.registered ? "registered" : ""}</td>
    `;
    accountsBody.appendChild(row);
  }
  renderLogs(state.logs);
}

async function refresh() {
  const requestedPage = logPage;
  const seq = ++logRefreshSeq;
  const state = await api(
    `/api/state?logPage=${requestedPage}&logLimit=${LOG_PAGE_SIZE}`,
  );
  if (seq !== logRefreshSeq) {
    return;
  }
  render(state);
}

logsPrev.onclick = async () => {
  if (logPage <= 1) {
    return;
  }
  logPage -= 1;
  try {
    await refresh();
  } catch (error) {
    showError(error);
  }
};

logsNext.onclick = async () => {
  logPage += 1;
  try {
    await refresh();
  } catch (error) {
    showError(error);
  }
};

refresh().catch(showError);
setInterval(() => {
  refresh().catch(() => undefined);
}, 1000);
