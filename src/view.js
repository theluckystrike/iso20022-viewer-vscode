'use strict';
// View model for ISO 20022 Payment Viewer: pagination, search/filter by text, currency and message, transaction detail.

class Iso20022ViewModel {
  constructor(parsed, name, fileSize) {
    this.parsed = parsed;
    this.name = name;
    this.fileSize = fileSize;
    this.filter = { text: '', currency: '', msgId: '' };
    this.filtered = parsed.transactions.slice();
  }

  summary() {
    const s = this.parsed.stats;
    return {
      name: this.name,
      fileSize: this.fileSize,
      messageCount: s.messageCount,
      transactionCount: s.transactionCount,
      totalAmount: s.totalAmount,
      currencies: Object.entries(this.parsed.currencyCounts).sort((a, b) => b[1] - a[1]),
      types: Object.entries(this.parsed.typeCounts).sort((a, b) => b[1] - a[1]),
      errorCount: s.errorCount,
      warningCount: s.warningCount,
      messages: this.parsed.messages,
      findings: this.parsed.findings.slice(0, 200),
    };
  }

  totalCount() {
    return this.parsed.transactions.length;
  }

  count() {
    return this.filtered.length;
  }

  setFilter(f) {
    const text = f && typeof f.text === 'string' ? f.text.trim().toLowerCase() : '';
    const currency = f && typeof f.currency === 'string' ? f.currency.trim() : '';
    const msgId = f && typeof f.msgId === 'string' ? f.msgId.trim() : '';
    this.filter = { text, currency, msgId };
    this.filtered = this.parsed.transactions.filter((t) => {
      if (currency && t.currency !== currency) return false;
      if (msgId && t.msgId !== msgId) return false;
      if (text) {
        const hay = [
          t.msgId, t.msgType, t.batchId, t.endToEndId, t.instrId, t.uetr,
          t.direction, t.amount.toFixed(2), t.currency, t.valueDate,
          t.debtorName, t.debtorIban, t.debtorBic,
          t.creditorName, t.creditorIban, t.creditorBic,
          t.remittance, t.purpose, t.status,
        ].join(' ').toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    });
    return this.filtered.length;
  }

  rows(from, limit) {
    const start = Math.max(0, Number(from) || 0);
    const n = Math.max(1, Math.min(500, Number(limit) || 100));
    return this.filtered.slice(start, start + n).map((t) => ({
      index: t.index,
      line: t.line,
      msgId: t.msgId,
      msgType: t.msgType,
      endToEndId: t.endToEndId,
      direction: t.direction,
      amount: t.amount,
      signedAmount: t.signedAmount,
      currency: t.currency,
      valueDate: t.valueDate,
      debtorName: t.debtorName,
      debtorIban: t.debtorIban,
      creditorName: t.creditorName,
      creditorIban: t.creditorIban,
      creditorBic: t.creditorBic,
      remittance: t.remittance,
      ibanValid: t.ibanValid,
      hasIssue: t.hasIssue,
    }));
  }

  detail(index) {
    return this.parsed.transactions.find((x) => x.index === index) || this.parsed.transactions[0] || null;
  }
}

module.exports = { Iso20022ViewModel };
