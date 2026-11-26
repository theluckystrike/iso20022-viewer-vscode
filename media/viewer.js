/* global acquireVsCodeApi */
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');

  let state = {
    name: '',
    summary: null,
    pageSize: 100,
    page: 0,
    total: 0,
    rows: [],
    selected: null,
    tab: 'payments',
    req: 0,
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function post(msg) {
    state.req += 1;
    vscode.postMessage({ ...msg, req: state.req });
  }

  function fmtSize(n) {
    if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
  }

  function fmtMoney(v, ccy) {
    if (v == null || !Number.isFinite(v)) return '-';
    const sign = v < 0 ? '-' : '';
    const abs = Math.abs(v).toFixed(2);
    return ccy ? `${sign}${ccy} ${abs}` : `${sign}${abs}`;
  }

  function renderShell() {
    const s = state.summary;
    const errChip = s.errorCount > 0 ? `<span class="chip bad"><b>Errors:</b> ${s.errorCount}</span>` : '<span class="chip"><b>Checks:</b> OK</span>';
    const warnChip = s.warningCount > 0 ? `<span class="chip warn"><b>Warnings:</b> ${s.warningCount}</span>` : '';
    const ccyOpts = (s.currencies || []).map(([c, n]) => `<option value="${esc(c)}">${esc(c)} (${n})</option>`).join('');
    const msgOpts = (s.messages || []).map((m) => `<option value="${esc(m.id)}">${esc(m.id)} · ${esc(m.msgType)}</option>`).join('');
    const typeBadges = (s.types || []).map(([t]) => t).join(', ') || 'ISO 20022';

    app.innerHTML = `
      <div class="top">
        <div class="title">
          <span class="name">${esc(state.name)}</span>
          <span class="kind">ISO 20022 (${esc(typeBadges)}) · ${fmtSize(s.fileSize)}</span>
        </div>
        <div class="summary">
          <span class="chip"><b>Messages:</b> ${s.messageCount}</span>
          <span class="chip"><b>Payments / Entries:</b> ${s.transactionCount}</span>
          <span class="chip"><b>Total:</b> ${s.totalAmount.toFixed(2)}</span>
          ${errChip}${warnChip}
        </div>
        <div class="toolbar">
          <input id="q" type="search" placeholder="Filter by IBAN, BIC, debtor, creditor, EndToEndId, amount or remittance..." />
          <select id="ccyFilter">
            <option value="">All currencies</option>
            ${ccyOpts}
          </select>
          <select id="msgFilter">
            <option value="">All messages</option>
            ${msgOpts}
          </select>
          <button id="filterBtn" type="button">Filter</button>
          <span class="sep"></span>
          <div id="protools"></div>
        </div>
        <div class="tabs">
          <button class="tab on" data-tab="payments" type="button">Payments &amp; Entries (${s.transactionCount})</button>
          <button class="tab" data-tab="headers" type="button">Message Headers (${s.messageCount})</button>
          <button class="tab" data-tab="findings" type="button">Validation Findings (${s.errorCount + s.warningCount})</button>
        </div>
        <div id="hint" class="hint"></div>
      </div>
      <div class="main">
        <div id="leftPane" class="tablewrap"></div>
        <div id="detail" class="detail"><p class="muted">Select a payment or statement entry to inspect IBAN, BIC, remittance info and validation status.</p></div>
      </div>
      <div class="pager">
        <button id="prev" type="button">Prev</button>
        <span id="pageInfo"></span>
        <button id="next" type="button">Next</button>
      </div>
    `;

    const q = document.getElementById('q');
    const ccySel = document.getElementById('ccyFilter');
    const msgSel = document.getElementById('msgFilter');
    const runFilter = () => {
      state.page = 0;
      post({ type: 'filter', filter: { text: q.value, currency: ccySel.value, msgId: msgSel.value } });
    };
    document.getElementById('filterBtn').addEventListener('click', runFilter);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') runFilter(); });
    ccySel.addEventListener('change', runFilter);
    msgSel.addEventListener('change', runFilter);

    document.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((b) => b.classList.remove('on'));
        btn.classList.add('on');
        state.tab = btn.dataset.tab;
        renderPane();
      });
    });

    document.getElementById('prev').addEventListener('click', () => {
      if (state.page > 0) { state.page -= 1; loadPage(); }
    });
    document.getElementById('next').addEventListener('click', () => {
      if ((state.page + 1) * state.pageSize < state.total) { state.page += 1; loadPage(); }
    });
  }

  function loadPage() {
    post({ type: 'page', from: state.page * state.pageSize, n: state.pageSize });
  }

  function renderPane() {
    const left = document.getElementById('leftPane');
    const pager = document.querySelector('.pager');
    const s = state.summary;

    if (state.tab === 'headers') {
      pager.style.display = 'none';
      const rows = (s.messages || []).map((m) => {
        const nbText = `${m.nbOfTxsDeclared != null ? m.nbOfTxsDeclared : '-'} / ${m.nbOfTxsActual}`;
        const sumText = `${m.ctrlSumDeclared != null ? m.ctrlSumDeclared.toFixed(2) : '-'} / ${m.ctrlSumActual.toFixed(2)}`;
        const ok = m.nbOfTxsOk && m.ctrlSumOk && m.ibanFailed === 0;
        const statusCls = ok ? 'ok' : 'bad';
        const statusLabel = ok ? 'PASS' : 'MISMATCH';
        return `<tr>
          <td class="num">${m.index}</td>
          <td><strong>${esc(m.msgType)}</strong></td>
          <td>${esc(m.id)}</td>
          <td>${esc(m.creDtTm || '-')}</td>
          <td>${esc(m.initgPty || '-')}</td>
          <td class="num">${esc(nbText)}</td>
          <td class="num">${esc(sumText)}</td>
          <td>${esc((m.currencies || []).join(', ') || '-')}</td>
          <td class="${statusCls}">${statusLabel}</td>
        </tr>`;
      }).join('');
      left.innerHTML = `<table id="grid"><thead><tr><th class="num">#</th><th>Type</th><th>MsgId</th><th>Created</th><th>Initiating Party</th><th class="num">NbOfTxs (Decl/Act)</th><th class="num">CtrlSum (Decl/Act)</th><th>Currency</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="muted">No message headers found.</td></tr>'}</tbody></table>`;
      return;
    }

    if (state.tab === 'findings') {
      pager.style.display = 'none';
      const fRows = (s.findings || []).map((f) => `<tr>
        <td class="${f.severity === 'error' ? 'bad' : ''}">${esc(f.severity.toUpperCase())}</td>
        <td class="num">${f.msgIndex}</td>
        <td class="num">${f.line}</td>
        <td>${esc(f.field)}</td>
        <td>${esc(f.finding)}</td>
      </tr>`).join('');
      left.innerHTML = fRows
        ? `<table id="grid"><thead><tr><th>Severity</th><th class="num">Msg #</th><th class="num">Line</th><th>Field</th><th>Finding</th></tr></thead><tbody>${fRows}</tbody></table>`
        : '<p class="muted" style="padding:12px;">All CtrlSum, NbOfTxs, IBAN MOD-97, BIC, currency and MsgId checks passed.</p>';
      return;
    }

    pager.style.display = 'flex';
    const body = state.rows.map((r) => {
      const sel = state.selected === r.index ? ' class="sel"' : '';
      const badge = r.hasIssue ? '<span class="badge-mismatch">CHECK</span>' : '';
      const amtCls = r.direction === 'DBIT' ? 'bad' : 'ok';
      return `<tr data-idx="${r.index}"${sel}>
        <td class="num">${r.index}</td>
        <td><strong>${esc(r.endToEndId || '-')}</strong>${badge}</td>
        <td>${esc(r.direction)}</td>
        <td class="num ${amtCls}">${esc(fmtMoney(r.amount, r.currency))}</td>
        <td>${esc(r.debtorName || r.debtorIban || '-')}</td>
        <td>${esc(r.creditorName || '-')}</td>
        <td><code>${esc(r.creditorIban || '-')}</code></td>
        <td>${esc(r.remittance || '-')}</td>
      </tr>`;
    }).join('');
    left.innerHTML = `<table id="grid">
      <thead><tr><th class="num">#</th><th>EndToEndId</th><th>Dir</th><th class="num">Amount</th><th>Debtor</th><th>Creditor</th><th>Creditor IBAN</th><th>Remittance</th></tr></thead>
      <tbody>${body || '<tr><td colspan="8" class="muted">No matching payments or entries.</td></tr>'}</tbody>
    </table>`;

    left.querySelectorAll('tbody tr[data-idx]').forEach((tr) => {
      tr.addEventListener('click', () => {
        const idx = Number(tr.dataset.idx);
        state.selected = idx;
        left.querySelectorAll('tbody tr').forEach((row) => row.classList.toggle('sel', Number(row.dataset.idx) === idx));
        post({ type: 'detail', index: idx });
      });
    });

    const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
    document.getElementById('pageInfo').textContent = `Page ${state.page + 1} of ${pages} (${state.total} rows)`;
    document.getElementById('prev').disabled = state.page <= 0;
    document.getElementById('next').disabled = (state.page + 1) * state.pageSize >= state.total;
  }

  function renderDetail(d) {
    const el = document.getElementById('detail');
    if (!d) {
      el.innerHTML = '<p class="muted">No transaction selected.</p>';
      return;
    }
    const pairs = [
      ['MsgId', d.msgId],
      ['Message Type', d.msgType],
      ['Batch / Stmt ID', d.batchId || '-'],
      ['EndToEndId', d.endToEndId || '-'],
      ['InstrId', d.instrId || '-'],
      ['UETR', d.uetr || '-'],
      ['Amount', fmtMoney(d.amount, d.currency)],
      ['Direction', d.direction || '-'],
      ['Value / Exec Date', d.valueDate || '-'],
      ['Debtor Name', d.debtorName || '-'],
      ['Debtor IBAN', d.debtorIban || '-'],
      ['Debtor BIC', d.debtorBic || '-'],
      ['Creditor Name', d.creditorName || '-'],
      ['Creditor IBAN', d.creditorIban || '-'],
      ['Creditor BIC', d.creditorBic || '-'],
      ['Remittance', d.remittance || '-'],
      ['IBAN MOD-97', d.ibanValid ? 'PASS' : 'INVALID'],
      ['Status', d.status || '-'],
    ];
    const rows = pairs.map(([k, v]) => `<tr><td><strong>${esc(k)}</strong></td><td><code>${esc(v)}</code></td></tr>`).join('');
    el.innerHTML = `
      <div class="dhead"><strong>#${d.index}: ${esc(d.endToEndId || d.msgId)}</strong><span class="muted">Line ${d.line}</span></div>
      <table class="splits"><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>
    `;
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || typeof m !== 'object') return;
    switch (m.type) {
      case 'init':
        if (m.error) {
          app.innerHTML = `<div class="error"><strong>Could not open ${esc(m.name)}</strong><p>${esc(m.error)}</p></div>`;
          return;
        }
        state.name = m.name;
        state.summary = m.summary;
        state.pageSize = m.pageSize || 100;
        state.page = 0;
        renderShell();
        loadPage();
        return;
      case 'pageResult':
        state.total = m.total;
        state.rows = m.rows || [];
        renderPane();
        if (state.rows.length && state.selected == null) {
          state.selected = state.rows[0].index;
          post({ type: 'detail', index: state.selected });
        }
        return;
      case 'filterResult':
        state.total = m.count;
        document.getElementById('hint').textContent = m.count < m.total ? `Showing ${m.count} of ${m.total} rows.` : '';
        loadPage();
        return;
      case 'detailResult':
        renderDetail(m.detail);
        return;
      case 'zovoAlso': {
        const anchor = m.anchor && document.getElementById(m.anchor);
        if (anchor && m.html) {
          const old = document.querySelector('.zovo-also');
          if (old) old.remove();
          anchor.insertAdjacentHTML('afterend', m.html);
        }
        return;
      }
      case 'hint':
        if (document.getElementById('hint')) document.getElementById('hint').textContent = m.text || '';
        return;
      default:
    }
  });

  post({ type: 'ready' });
})();
