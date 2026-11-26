'use strict';
// Pro tools for ISO 20022 Payment Viewer:
//   1. auditControlTotals: CtrlSum, NbOfTxs, IBAN MOD-97, currency and duplicate MsgId audit report in Markdown.
//   2. exportCsvJson: Write transactions.csv, headers.csv and structured JSON locally. Never overwrites existing files.
//   3. diffBatches: Compare two ISO 20022 payment batches in Markdown.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const {
  parseIso20022,
  buildTransactionsCsv,
  buildHeadersCsv,
  buildIso20022Json,
  buildAuditMarkdown,
  buildBatchDiffMarkdown,
} = require('./iso20022');

const ISO_EXT_RE = /\.(iso20022|pain001|camt053|pacs008|sepa|xml)$/i;
const ISO_FILTERS = { 'ISO 20022 File': ['iso20022', 'ISO20022', 'pain001', 'PAIN001', 'camt053', 'CAMT053', 'pacs008', 'PACS008', 'sepa', 'SEPA', 'xml'] };

function uniquePath(targetPath) {
  if (!fs.existsSync(targetPath)) return targetPath;
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);
  for (let i = 1; i < 10000; i++) {
    const cand = path.join(dir, `${base}-${i}${ext}`);
    if (!fs.existsSync(cand)) return cand;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

async function resolveTargetUri(uri, provider, openLabel = 'Select ISO 20022 file') {
  if (uri && uri.scheme) return uri;
  if (provider && provider.active && provider.active.uri) return provider.active.uri;
  const ed = vscode.window.activeTextEditor;
  if (ed && ed.document && ISO_EXT_RE.test(ed.document.uri.fsPath || ed.document.uri.path)) return ed.document.uri;
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: ISO_FILTERS,
    openLabel,
  });
  return picked && picked[0] ? picked[0] : null;
}

function listIsoFilesInDir(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && ISO_EXT_RE.test(e.name))
    .map((e) => path.join(dirPath, e.name))
    .sort();
}

function createTools({ provider, pro, reach }) {
  async function auditControlTotals(uri, opts = {}) {
    if (!(await pro.allowed('auditControlTotals', opts))) return undefined;
    const target = await resolveTargetUri(uri, provider);
    if (!target) return undefined;

    const targetPath = target.fsPath;
    const isDir = target.scheme === 'file' && fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
    const files = isDir ? listIsoFilesInDir(targetPath) : [targetPath];
    if (!files.length) {
      vscode.window.showInformationMessage('No ISO 20022 files were found in this folder.');
      return undefined;
    }

    const entries = [];
    for (const f of files) {
      const buf = f === targetPath && target.scheme !== 'file'
        ? Buffer.from(await vscode.workspace.fs.readFile(target))
        : fs.readFileSync(f);
      entries.push({ fileName: path.basename(f), parsed: parseIso20022(buf) });
    }
    const md = buildAuditMarkdown(entries);
    const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: false });
    await pro.produced('auditControlTotals');
    if (reach) reach.refresh();
    return { files: files.length, markdown: md };
  }

  async function exportCsvJson(uri, opts = {}) {
    if (!(await pro.allowed('exportCsvJson', opts))) return undefined;
    const target = await resolveTargetUri(uri, provider);
    if (!target) return undefined;

    const targetPath = target.fsPath;
    const bytes = await vscode.workspace.fs.readFile(target);
    const parsed = parseIso20022(Buffer.from(bytes));
    const baseName = path.basename(targetPath, path.extname(targetPath));
    const defaultOut = uniquePath(path.join(path.dirname(targetPath), `${baseName}-transactions.csv`));
    const saveUri = opts.outPath
      ? vscode.Uri.file(uniquePath(opts.outPath))
      : await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultOut),
        filters: { 'CSV file': ['csv'] },
        saveLabel: 'Save transactions CSV',
      });
    if (!saveUri) return undefined;

    const txPath = uniquePath(saveUri.fsPath);
    const dir = path.dirname(txPath);
    const stem = path.basename(txPath, '.csv');
    const headersPath = uniquePath(path.join(dir, `${stem}-headers.csv`));
    const jsonPath = uniquePath(path.join(dir, `${stem}.json`));

    fs.writeFileSync(txPath, buildTransactionsCsv(parsed, path.basename(targetPath)), 'utf8');
    fs.writeFileSync(headersPath, buildHeadersCsv(parsed, path.basename(targetPath)), 'utf8');
    fs.writeFileSync(jsonPath, buildIso20022Json(parsed, path.basename(targetPath)), 'utf8');

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(txPath));
    await vscode.window.showTextDocument(doc, { preview: false });
    await pro.produced('exportCsvJson');
    if (reach) reach.refresh();
    return { files: [txPath, headersPath, jsonPath], transactions: parsed.stats.transactionCount };
  }

  async function diffBatches(uri, opts = {}) {
    if (!(await pro.allowed('diffBatches', opts))) return undefined;
    const left = await resolveTargetUri(uri, provider, 'Select first ISO 20022 file');
    if (!left) return undefined;

    let right = opts.compareUri || null;
    if (!right) {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: ISO_FILTERS,
        openLabel: 'Select second ISO 20022 file to compare',
      });
      right = picked && picked[0] ? picked[0] : null;
    }
    if (!right) return undefined;

    const leftBuf = Buffer.from(await vscode.workspace.fs.readFile(left));
    const rightBuf = Buffer.from(await vscode.workspace.fs.readFile(right));
    const md = buildBatchDiffMarkdown(
      path.basename(left.fsPath || left.path),
      parseIso20022(leftBuf),
      path.basename(right.fsPath || right.path),
      parseIso20022(rightBuf),
    );
    const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: false });
    await pro.produced('diffBatches');
    if (reach) reach.refresh();
    return { markdown: md };
  }

  return { auditControlTotals, exportCsvJson, diffBatches };
}

module.exports = { createTools, uniquePath };
