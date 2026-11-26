'use strict';
// Unit tests for ISO 20022 Payment Viewer: pain.001, pacs.008, camt.053/054 parsing,
// GrpHdr extraction, CtrlSum & NbOfTxs checks, IBAN MOD-97 & BIC validation,
// duplicate MsgId detection, CSV/JSON/Markdown exports, batch diff, ViewModel, strict CSP and Pro 1-free-try enforcement.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  parseIso20022,
  validateIban,
  validateBic,
  buildTransactionsCsv,
  buildHeadersCsv,
  buildIso20022Json,
  buildAuditMarkdown,
  buildBatchDiffMarkdown,
} = require('../src/iso20022');
const { Iso20022ViewModel } = require('../src/view');
const { editorHtml } = require('../src/html');
const { createPro, TRIES, TRIAL_KEY } = require('../src/pro');

const SAMPLE = fs.readFileSync(path.join(__dirname, '..', 'samples', 'sample.pain001'), 'utf8');

test('parseIso20022: parses sample pain.001 with zero errors and valid control totals', () => {
  const parsed = parseIso20022(SAMPLE);
  assert.equal(parsed.stats.messageCount, 1);
  assert.equal(parsed.stats.transactionCount, 3);
  assert.equal(parsed.stats.totalAmount, 42500.5);
  assert.equal(parsed.stats.errorCount, 0);
  assert.equal(parsed.stats.warningCount, 0);

  const m = parsed.messages[0];
  assert.equal(m.id, 'MSG-20261124-001');
  assert.equal(m.msgType, 'pain.001');
  assert.equal(m.nbOfTxsDeclared, 3);
  assert.equal(m.nbOfTxsActual, 3);
  assert.equal(m.nbOfTxsOk, true);
  assert.equal(m.ctrlSumDeclared, 42500.5);
  assert.equal(m.ctrlSumActual, 42500.5);
  assert.equal(m.ctrlSumOk, true);
  assert.equal(m.ibanFailed, 0);

  const tx0 = parsed.transactions[0];
  assert.equal(tx0.endToEndId, 'E2E-INV-2026-8841');
  assert.equal(tx0.amount, 25000);
  assert.equal(tx0.currency, 'EUR');
  assert.equal(tx0.debtorIban, 'DE89370400440532013000');
  assert.equal(tx0.creditorIban, 'NL91ABNA0417164300');
  assert.equal(tx0.creditorBic, 'ABNANL2AXXX');
  assert.equal(tx0.ibanValid, true);
});

test('parseIso20022: parses pacs.008 FI-to-FI credit transfer', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>PACS-2026-001</MsgId>
      <CreDtTm>2026-11-24T10:00:00Z</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <TtlIntrBkSttlmAmt Ccy="EUR">15000.00</TtlIntrBkSttlmAmt>
      <SttlmInf><SttlmMtd>CLRG</SttlmMtd></SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId><EndToEndId>E2E-PACS-1</EndToEndId><TxId>TX-001</TxId></PmtId>
      <IntrBkSttlmAmt Ccy="EUR">15000.00</IntrBkSttlmAmt>
      <IntrBkSttlmDt>2026-11-24</IntrBkSttlmDt>
      <Dbtr><Nm>ALPHA CORP</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>DE89370400440532013000</IBAN></Id></DbtrAcct>
      <DbtrAgt><FinInstnId><BICFI>DEUTDEFFXXX</BICFI></FinInstnId></DbtrAgt>
      <CdtrAgt><FinInstnId><BICFI>ABNANL2AXXX</BICFI></FinInstnId></CdtrAgt>
      <Cdtr><Nm>BETA BV</Nm></Cdtr>
      <CdtrAcct><Id><IBAN>NL91ABNA0417164300</IBAN></Id></CdtrAcct>
      <RmtInf><Ustrd>INTERBANK SETTLEMENT</Ustrd></RmtInf>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`;
  const parsed = parseIso20022(xml);
  assert.equal(parsed.messages[0].msgType, 'pacs.008');
  assert.equal(parsed.stats.transactionCount, 1);
  assert.equal(parsed.stats.errorCount, 0);
  assert.equal(parsed.transactions[0].amount, 15000);
  assert.equal(parsed.transactions[0].remittance, 'INTERBANK SETTLEMENT');
});

test('parseIso20022: parses camt.053 bank statement and checks opening-to-closing balance', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <GrpHdr>
      <MsgId>CAMT-2026-001</MsgId>
      <CreDtTm>2026-11-24T18:00:00Z</CreDtTm>
    </GrpHdr>
    <Stmt>
      <Id>STMT-001</Id>
      <Acct>
        <Id><IBAN>DE89370400440532013000</IBAN></Id>
        <Ccy>EUR</Ccy>
        <Ownr><Nm>ACME GMBH</Nm></Ownr>
      </Acct>
      <Bal>
        <Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">10000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-11-23</Dt></Dt>
      </Bal>
      <Bal>
        <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">12500.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>2026-11-24</Dt></Dt>
      </Bal>
      <Ntry>
        <NtryRef>NTRY-1</NtryRef>
        <Amt Ccy="EUR">3000.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <ValDt><Dt>2026-11-24</Dt></ValDt>
        <NtryDtls><TxDtls>
          <Refs><EndToEndId>E2E-IN-1</EndToEndId></Refs>
          <RltdPties><Dbtr><Pty><Nm>CLIENT SA</Nm></Pty></Dbtr></RltdPties>
          <RmtInf><Ustrd>RECEIPT 101</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <NtryRef>NTRY-2</NtryRef>
        <Amt Ccy="EUR">500.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <ValDt><Dt>2026-11-24</Dt></ValDt>
        <AddtlNtryInf>BANK FEE</AddtlNtryInf>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
  const parsed = parseIso20022(xml);
  assert.equal(parsed.messages[0].msgType, 'camt.053');
  assert.equal(parsed.stats.transactionCount, 2);
  assert.equal(parsed.stats.errorCount, 0);
  assert.equal(parsed.transactions[0].signedAmount, 3000);
  assert.equal(parsed.transactions[1].signedAmount, -500);
});

test('validateIban and validateBic: detect valid and invalid IBAN MOD-97 and BIC codes', () => {
  assert.equal(validateIban('DE89 3704 0044 0532 0130 00').valid, true);
  assert.equal(validateIban('NL91ABNA0417164300').valid, true);
  assert.equal(validateIban('GB29NWBK60161331926819').valid, true);
  assert.equal(validateIban('DE89370400440532013001').valid, false);
  assert.equal(validateIban('DE00123').valid, false);

  assert.equal(validateBic('DEUTDEFFXXX').valid, true);
  assert.equal(validateBic('ABNANL2A').valid, true);
  assert.equal(validateBic('BADBIC').valid, false);
});

test('parseIso20022: detects CtrlSum mismatch, NbOfTxs mismatch, invalid IBAN and duplicate MsgId', () => {
  const broken = SAMPLE
    .replace('<NbOfTxs>3</NbOfTxs>', '<NbOfTxs>5</NbOfTxs>')
    .replace('<CtrlSum>42500.50</CtrlSum>', '<CtrlSum>99999.00</CtrlSum>')
    .replace('NL91ABNA0417164300', 'NL91ABNA0417164309');
  const dup = `${broken}\n${SAMPLE}`;
  const parsed = parseIso20022(dup);
  assert.ok(parsed.findings.some((f) => f.field === 'GrpHdr/NbOfTxs'));
  assert.ok(parsed.findings.some((f) => f.field === 'GrpHdr/CtrlSum'));
  assert.ok(parsed.findings.some((f) => f.field === 'Creditor IBAN'));
  assert.ok(parsed.findings.some((f) => f.severity === 'warning' && f.finding.includes('Duplicate MsgId')));
});

test('exports: buildTransactionsCsv, buildHeadersCsv, buildIso20022Json, audit and batch diff Markdown', () => {
  const parsed = parseIso20022(SAMPLE);
  const txCsv = buildTransactionsCsv(parsed, 'sample.pain001');
  assert.ok(txCsv.startsWith('file,index,msg_id,msg_type,batch_id,end_to_end_id'));
  assert.ok(txCsv.includes('E2E-INV-2026-8841'));
  assert.ok(txCsv.includes('NL91ABNA0417164300'));

  const hdrCsv = buildHeadersCsv(parsed, 'sample.pain001');
  assert.ok(hdrCsv.startsWith('file,msg_index,msg_id,msg_type'));
  assert.ok(hdrCsv.includes('MSG-20261124-001'));

  const json = JSON.parse(buildIso20022Json(parsed, 'sample.pain001'));
  assert.equal(json.file, 'sample.pain001');
  assert.equal(json.messages.length, 1);
  assert.equal(json.transactions.length, 3);

  const md = buildAuditMarkdown([{ fileName: 'sample.pain001', parsed }]);
  assert.ok(md.includes('# ISO 20022 Control-Total & IBAN Audit Report'));
  assert.ok(md.includes('Files checked: 1'));
  assert.ok(md.includes('Total messages: 1'));
  assert.ok(md.includes('PASS'));

  const modified = SAMPLE.replace('25000.00', '26500.00');
  const diffMd = buildBatchDiffMarkdown('left.pain001', parsed, 'right.pain001', parseIso20022(modified));
  assert.ok(diffMd.includes('# ISO 20022 Payment Batch Comparison Report'));
  assert.ok(diffMd.includes('Changed: 1'));
  assert.ok(diffMd.includes('26500.00'));
});

test('Iso20022ViewModel: filters by text, currency and msgId and returns detail', () => {
  const parsed = parseIso20022(SAMPLE);
  const vm = new Iso20022ViewModel(parsed, 'sample.pain001', SAMPLE.length);
  assert.equal(vm.totalCount(), 3);
  assert.equal(vm.setFilter({ currency: 'EUR' }), 3);
  assert.equal(vm.setFilter({ text: 'ATELIER LYON' }), 1);
  assert.equal(vm.rows(0, 10)[0].creditorIban, 'FR7630006000011234567890189');
  assert.equal(vm.detail(1).endToEndId, 'E2E-INV-2026-8841');
});

test('editorHtml: enforces strict CSP with nonce and no unsafe-inline', () => {
  const html = editorHtml({
    cspSource: 'vscode-webview://test',
    script: 'vscode-webview://test/viewer.js',
    styleUri: 'vscode-webview://test/viewer.css',
    title: 'sample.pain001',
    nonce: 'testnonce123',
  });
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("script-src 'nonce-testnonce123'"));
  assert.ok(!html.includes('unsafe-inline'));
  assert.ok(!html.includes('unsafe-eval'));
});

test('pro: enforces 1 free try per tool and triggers requirePro after try is used', async () => {
  assert.equal(TRIES, 1);
  const store = new Map();
  const requireCalls = [];
  let statusMsg = '';
  const fakeVscode = {
    EventEmitter: class {
      constructor() { this.ls = []; this.event = (fn) => { this.ls.push(fn); return { dispose() {} }; }; }
      fire(v) { this.ls.forEach((fn) => fn(v)); }
      dispose() {}
    },
    window: { setStatusBarMessage(m) { statusMsg = m; } },
  };
  const fakeLic = {
    isPro: () => false,
    requirePro: async (title, opts) => { requireCalls.push({ title, opts }); return false; },
  };
  const context = {
    subscriptions: [],
    globalState: { get: (k) => store.get(k), update: async (k, v) => { store.set(k, v); } },
  };
  const pro = createPro({ vscode: fakeVscode, context, license: fakeLic });

  for (const [idx, feat] of ['auditControlTotals', 'exportCsvJson', 'diffBatches'].entries()) {
    assert.equal(pro.left(feat), 1);
    assert.equal(await pro.allowed(feat, { surface: 'toolbar' }), true);
    await pro.produced(feat);
    assert.equal(pro.left(feat), 0);
    assert.ok(statusMsg.includes('1 of 1'));
    assert.equal(await pro.allowed(feat, { surface: 'toolbar' }), false);
    assert.equal(requireCalls.length, idx + 1);
  }
  assert.deepEqual(store.get(TRIAL_KEY), { auditControlTotals: 1, exportCsvJson: 1, diffBatches: 1 });
});
