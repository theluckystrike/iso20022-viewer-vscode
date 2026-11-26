'use strict';
// Offline ISO 20022 XML parser & validator (pain.001, pacs.008, camt.053, camt.054).
// Plain JavaScript, zero external dependencies, zero network access.

const IBAN_LENGTHS = {
  AL: 28, AD: 24, AT: 20, AZ: 28, BH: 22, BY: 28, BE: 16, BA: 20, BR: 29, BG: 22,
  CR: 22, HR: 21, CY: 28, CZ: 24, DK: 18, DO: 28, TL: 23, EE: 20, FO: 18, FI: 18,
  FR: 27, GE: 22, DE: 22, GI: 23, GR: 27, GL: 18, GT: 28, HU: 28, IS: 26, IQ: 23,
  IE: 22, IL: 23, IT: 27, JO: 30, KZ: 20, XK: 20, KW: 30, LV: 21, LB: 28, LI: 21,
  LT: 20, LU: 20, MK: 19, MT: 31, MR: 27, MU: 30, MC: 27, MD: 24, ME: 22, NL: 18,
  NO: 15, PK: 24, PS: 29, PL: 28, PT: 25, QA: 29, RO: 24, LC: 32, SM: 27, ST: 25,
  SA: 24, RS: 22, SC: 31, SK: 24, SI: 19, ES: 24, SE: 24, CH: 21, TN: 24, TR: 26,
  UA: 29, AE: 23, GB: 22, VA: 22, VG: 24,
};

const MSG_TYPE_NAMES = {
  'pain.001': 'Customer Credit Transfer Initiation',
  'pacs.008': 'FI-to-FI Customer Credit Transfer',
  'camt.053': 'Bank-to-Customer Statement',
  'camt.054': 'Bank-to-Customer Debit/Credit Notification',
};

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function localName(qname) {
  const i = qname.indexOf(':');
  return i >= 0 ? qname.slice(i + 1) : qname;
}

function parseAttrs(str) {
  const attrs = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(str))) {
    attrs[m[1]] = decodeEntities(m[2] !== undefined ? m[2] : m[3]);
  }
  return attrs;
}

function parseXml(xmlStr) {
  const text = String(xmlStr || '').replace(/^\uFEFF/, '');
  const roots = [];
  const stack = [];
  const errors = [];
  let line = 1;
  let i = 0;
  const len = text.length;

  function advanceLines(chunk) {
    for (let k = 0; k < chunk.length; k++) {
      if (chunk.charCodeAt(k) === 10) line += 1;
    }
  }

  while (i < len) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      const tail = text.slice(i);
      if (stack.length && tail.trim()) stack[stack.length - 1].text += decodeEntities(tail);
      break;
    }
    if (lt > i) {
      const chunk = text.slice(i, lt);
      if (stack.length) stack[stack.length - 1].text += decodeEntities(chunk);
      advanceLines(chunk);
    }
    const startLine = line;

    // Comment
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end < 0) { errors.push({ line: startLine, message: 'Unclosed XML comment' }); break; }
      advanceLines(text.slice(lt, end + 3));
      i = end + 3;
      continue;
    }
    // CDATA
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end < 0) { errors.push({ line: startLine, message: 'Unclosed CDATA section' }); break; }
      if (stack.length) stack[stack.length - 1].text += text.slice(lt + 9, end);
      advanceLines(text.slice(lt, end + 3));
      i = end + 3;
      continue;
    }
    // Processing instruction or XML declaration
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end < 0) { errors.push({ line: startLine, message: 'Unclosed processing instruction' }); break; }
      advanceLines(text.slice(lt, end + 2));
      i = end + 2;
      continue;
    }
    // DOCTYPE
    if (text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt + 2);
      if (end < 0) { errors.push({ line: startLine, message: 'Unclosed XML declaration' }); break; }
      advanceLines(text.slice(lt, end + 1));
      i = end + 1;
      continue;
    }

    const gt = text.indexOf('>', lt + 1);
    if (gt < 0) { errors.push({ line: startLine, message: 'Unclosed XML tag' }); break; }
    const rawTag = text.slice(lt + 1, gt);
    advanceLines(text.slice(lt, gt + 1));
    i = gt + 1;

    if (rawTag.startsWith('/')) {
      const closeName = localName(rawTag.slice(1).trim());
      if (!stack.length) {
        errors.push({ line: startLine, message: `Unexpected closing tag </${closeName}>` });
        continue;
      }
      const top = stack[stack.length - 1];
      if (top.name === closeName) {
        top.text = top.text.trim();
        stack.pop();
      } else {
        let found = -1;
        for (let s = stack.length - 2; s >= 0; s--) {
          if (stack[s].name === closeName) { found = s; break; }
        }
        if (found >= 0) {
          errors.push({ line: startLine, message: `Mismatched closing tag </${closeName}> (expected </${top.name}>)` });
          while (stack.length > found) {
            const p = stack.pop();
            p.text = p.text.trim();
          }
        } else {
          errors.push({ line: startLine, message: `Unmatched closing tag </${closeName}>` });
        }
      }
      continue;
    }

    const selfClose = rawTag.endsWith('/');
    const inner = selfClose ? rawTag.slice(0, -1).trim() : rawTag.trim();
    const m = /^([A-Za-z_][\w:.-]*)([\s\S]*)$/.exec(inner);
    if (!m) {
      errors.push({ line: startLine, message: `Invalid XML tag <${rawTag.slice(0, 30)}>` });
      continue;
    }
    const qname = m[1];
    const node = {
      name: localName(qname),
      qname,
      attrs: parseAttrs(m[2]),
      children: [],
      text: '',
      line: startLine,
    };
    if (stack.length) {
      stack[stack.length - 1].children.push(node);
    } else {
      roots.push(node);
    }
    if (!selfClose) stack.push(node);
  }

  for (const unclosed of stack) {
    errors.push({ line: unclosed.line, message: `Unclosed XML element <${unclosed.name}>` });
  }
  return { roots, errors };
}

function child(node, name) {
  if (!node || !node.children) return null;
  for (const c of node.children) {
    if (c.name === name) return c;
  }
  return null;
}

function children(node, name) {
  if (!node || !node.children) return [];
  return node.children.filter((c) => c.name === name);
}

function pathNode(node, ...parts) {
  let cur = node;
  for (const p of parts) {
    if (!cur) return null;
    cur = child(cur, p);
  }
  return cur;
}

function pathText(node, ...parts) {
  const n = pathNode(node, ...parts);
  return n ? n.text : '';
}

function validateIban(raw) {
  const cleaned = String(raw || '').replace(/\s+/g, '').toUpperCase();
  if (!cleaned) return { valid: false, iban: '', country: '', reason: 'Empty IBAN' };
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(cleaned)) {
    return { valid: false, iban: cleaned, country: cleaned.slice(0, 2), reason: 'Invalid IBAN structure' };
  }
  const country = cleaned.slice(0, 2);
  const expectedLen = IBAN_LENGTHS[country];
  if (expectedLen && cleaned.length !== expectedLen) {
    return { valid: false, iban: cleaned, country, reason: `Expected ${expectedLen} characters for ${country}, got ${cleaned.length}` };
  }
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  let rem = 0;
  for (let i = 0; i < rearranged.length; i++) {
    const code = rearranged.charCodeAt(i);
    if (code >= 48 && code <= 57) {
      rem = (rem * 10 + (code - 48)) % 97;
    } else {
      const val = code - 55; // A=10 .. Z=35
      rem = (rem * 100 + val) % 97;
    }
  }
  if (rem !== 1) {
    return { valid: false, iban: cleaned, country, reason: `MOD-97 remainder is ${rem} (expected 1)` };
  }
  return { valid: true, iban: cleaned, country, reason: 'OK' };
}

function validateBic(raw) {
  const cleaned = String(raw || '').trim().toUpperCase();
  if (!cleaned) return { valid: false, bic: '', reason: 'Empty BIC' };
  const ok = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(cleaned);
  return { valid: ok, bic: cleaned, reason: ok ? 'OK' : 'BIC must be 8 or 11 ISO 9362 characters' };
}

function parseAmount(str) {
  if (str == null || str === '') return null;
  const n = Number(String(str).trim());
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function detectMessageType(docNode, bodyNode) {
  const xmlns = docNode.attrs.xmlns || Object.entries(docNode.attrs).find(([k]) => k.startsWith('xmlns:'))?.[1] || '';
  const m = /(pain|pacs|camt)\.\d{3}/i.exec(xmlns);
  if (m) return { msgType: m[0].toLowerCase(), schema: xmlns };
  const bName = bodyNode ? bodyNode.name : '';
  if (bName === 'CstmrCdtTrfInitn') return { msgType: 'pain.001', schema: xmlns };
  if (bName === 'FIToFICstmrCdtTrf') return { msgType: 'pacs.008', schema: xmlns };
  if (bName === 'BkToCstmrStmt') return { msgType: 'camt.053', schema: xmlns };
  if (bName === 'BkToCstmrDbtCdtNtfctn') return { msgType: 'camt.054', schema: xmlns };
  return { msgType: bName || 'unknown', schema: xmlns };
}

function extractRemittance(rmtNode) {
  if (!rmtNode) return '';
  const ustrds = children(rmtNode, 'Ustrd').map((u) => u.text).filter(Boolean);
  if (ustrds.length) return ustrds.join(' | ');
  const strd = child(rmtNode, 'Strd');
  if (strd) {
    const ref = pathText(strd, 'CdtrRefInf', 'Ref');
    const addtl = pathText(strd, 'AddtlRmtInf');
    return [ref, addtl].filter(Boolean).join(' - ');
  }
  return '';
}

function extractAccountId(acctNode) {
  if (!acctNode) return { iban: '', otherId: '', currency: '' };
  const iban = pathText(acctNode, 'Id', 'IBAN');
  const otherId = pathText(acctNode, 'Id', 'Othr', 'Id');
  const currency = pathText(acctNode, 'Ccy');
  return { iban, otherId, currency };
}

function extractBic(agtNode) {
  if (!agtNode) return '';
  return pathText(agtNode, 'FinInstnId', 'BICFI') || pathText(agtNode, 'FinInstnId', 'BIC') || '';
}

function collectDocuments(roots) {
  const docs = [];
  function walk(node) {
    if (node.name === 'Document') {
      docs.push(node);
      return;
    }
    if (node.name === 'CstmrCdtTrfInitn' || node.name === 'FIToFICstmrCdtTrf' || node.name === 'BkToCstmrStmt' || node.name === 'BkToCstmrDbtCdtNtfctn') {
      docs.push({ name: 'Document', attrs: node.attrs || {}, children: [node], text: '', line: node.line });
      return;
    }
    for (const c of node.children || []) walk(c);
  }
  for (const r of roots) walk(r);
  return docs;
}

function parseIso20022(bufOrStr) {
  const raw = Buffer.isBuffer(bufOrStr) ? bufOrStr.toString('utf8') : String(bufOrStr || '');
  if (!raw.trim()) throw new Error('The file is empty.');

  const { roots, errors: xmlErrors } = parseXml(raw);
  const docs = collectDocuments(roots);
  if (!docs.length) {
    throw new Error('No ISO 20022 <Document> element was found in this file.');
  }

  const messages = [];
  const transactions = [];
  const findings = [];
  const msgIdCounts = new Map();
  const e2eCounts = new Map();
  const typeCounts = {};
  const currencyCounts = {};

  for (const xe of xmlErrors) {
    findings.push({ severity: 'error', msgIndex: 0, line: xe.line, field: 'XML', finding: xe.message });
  }

  let txIndex = 0;

  docs.forEach((docNode, dIdx) => {
    const msgIndex = dIdx + 1;
    const bodyNode = docNode.children.find((c) => c.name !== 'AppHdr') || null;
    const { msgType, schema } = detectMessageType(docNode, bodyNode);
    const msgTypeName = MSG_TYPE_NAMES[msgType] || `ISO 20022 (${msgType})`;
    typeCounts[msgType] = (typeCounts[msgType] || 0) + 1;

    const grpHdr = bodyNode ? child(bodyNode, 'GrpHdr') : null;
    const msgId = pathText(grpHdr, 'MsgId') || '';
    const creDtTm = pathText(grpHdr, 'CreDtTm') || '';
    const nbOfTxsRaw = pathText(grpHdr, 'NbOfTxs');
    const nbOfTxsDeclared = nbOfTxsRaw ? Number(nbOfTxsRaw) : null;
    const ctrlSumRaw = pathText(grpHdr, 'CtrlSum');
    const ctrlSumDeclared = parseAmount(ctrlSumRaw);
    const initgPty = pathText(grpHdr, 'InitgPty', 'Nm') || pathText(grpHdr, 'InstgAgt', 'FinInstnId', 'BICFI') || '';
    const sttlmMtd = pathText(grpHdr, 'SttlmInf', 'SttlmMtd') || '';
    const ttlSttlmNode = pathNode(grpHdr, 'TtlIntrBkSttlmAmt');
    const ttlSttlmAmt = ttlSttlmNode ? parseAmount(ttlSttlmNode.text) : null;
    const ttlSttlmCcy = ttlSttlmNode ? (ttlSttlmNode.attrs.Ccy || '') : '';

    if (!grpHdr) {
      findings.push({ severity: 'error', msgIndex, line: docNode.line, field: 'GrpHdr', finding: `Message #${msgIndex} (${msgType}) is missing <GrpHdr>.` });
    } else {
      if (!msgId) findings.push({ severity: 'error', msgIndex, line: grpHdr.line, field: 'GrpHdr/MsgId', finding: `Message #${msgIndex} is missing mandatory <MsgId>.` });
      if (!creDtTm) findings.push({ severity: 'error', msgIndex, line: grpHdr.line, field: 'GrpHdr/CreDtTm', finding: `Message #${msgIndex} is missing mandatory <CreDtTm>.` });
    }
    if (msgId) {
      const prev = msgIdCounts.get(msgId) || 0;
      msgIdCounts.set(msgId, prev + 1);
      if (prev >= 1) {
        findings.push({ severity: 'warning', msgIndex, line: grpHdr ? grpHdr.line : docNode.line, field: 'GrpHdr/MsgId', finding: `Duplicate MsgId "${msgId}" appears in multiple messages.` });
      }
    }

    const msgTxs = [];
    const msgCurrencies = new Set();
    const balances = [];
    let ibanChecked = 0;
    let ibanFailed = 0;

    function checkIbanAndBic(iban, bic, role, line, tx) {
      if (iban) {
        ibanChecked += 1;
        const v = validateIban(iban);
        if (!v.valid) {
          ibanFailed += 1;
          tx.hasIssue = true;
          tx.ibanValid = false;
          findings.push({ severity: 'error', msgIndex, line, field: `${role} IBAN`, finding: `Invalid ${role} IBAN "${iban}": ${v.reason}.` });
        }
      }
      if (bic) {
        const bv = validateBic(bic);
        if (!bv.valid) {
          tx.hasIssue = true;
          findings.push({ severity: 'warning', msgIndex, line, field: `${role} BIC`, finding: `Invalid ${role} BIC "${bic}": ${bv.reason}.` });
        }
      }
    }

    function recordTx(tx) {
      txIndex += 1;
      tx.index = txIndex;
      tx.msgIndex = msgIndex;
      tx.msgId = msgId || `MSG-${msgIndex}`;
      tx.msgType = msgType;
      if (tx.currency) {
        msgCurrencies.add(tx.currency);
        currencyCounts[tx.currency] = (currencyCounts[tx.currency] || 0) + 1;
        if (!/^[A-Z]{3}$/.test(tx.currency)) {
          tx.hasIssue = true;
          findings.push({ severity: 'warning', msgIndex, line: tx.line, field: 'Ccy', finding: `Invalid ISO 4217 currency code "${tx.currency}".` });
        }
      }
      if (tx.endToEndId && tx.endToEndId.toUpperCase() !== 'NOTPROVIDED') {
        const k = `${tx.msgId}::${tx.endToEndId}`;
        const prev = e2eCounts.get(k) || 0;
        e2eCounts.set(k, prev + 1);
        if (prev >= 1) {
          tx.hasIssue = true;
          findings.push({ severity: 'warning', msgIndex, line: tx.line, field: 'EndToEndId', finding: `Duplicate EndToEndId "${tx.endToEndId}" in message ${tx.msgId}.` });
        }
      }
      msgTxs.push(tx);
      transactions.push(tx);
    }

    if (bodyNode && (msgType === 'pain.001' || bodyNode.name === 'CstmrCdtTrfInitn')) {
      const pmtInfs = children(bodyNode, 'PmtInf');
      for (const pmt of pmtInfs) {
        const pmtInfId = pathText(pmt, 'PmtInfId');
        const pmtMtd = pathText(pmt, 'PmtMtd');
        const reqdDt = pathText(pmt, 'ReqdExctnDt', 'Dt') || pathText(pmt, 'ReqdExctnDt');
        const dbtrName = pathText(pmt, 'Dbtr', 'Nm');
        const dbtrAcct = extractAccountId(child(pmt, 'DbtrAcct'));
        const dbtrBic = extractBic(child(pmt, 'DbtrAgt'));
        const pmtNbRaw = pathText(pmt, 'NbOfTxs');
        const pmtNbDecl = pmtNbRaw ? Number(pmtNbRaw) : null;
        const pmtCtrlDecl = parseAmount(pathText(pmt, 'CtrlSum'));

        const txNodes = children(pmt, 'CdtTrfTxInf');
        let pmtSum = 0;

        // Validate debtor IBAN/BIC once per PmtInf if present
        let dbtrIbanOk = true;
        if (dbtrAcct.iban) {
          ibanChecked += 1;
          const dv = validateIban(dbtrAcct.iban);
          if (!dv.valid) {
            dbtrIbanOk = false;
            ibanFailed += 1;
            findings.push({ severity: 'error', msgIndex, line: pmt.line, field: 'DbtrAcct/IBAN', finding: `Invalid Debtor IBAN "${dbtrAcct.iban}" in PmtInf ${pmtInfId || msgIndex}: ${dv.reason}.` });
          }
        }
        if (dbtrBic) {
          const bv = validateBic(dbtrBic);
          if (!bv.valid) {
            findings.push({ severity: 'warning', msgIndex, line: pmt.line, field: 'DbtrAgt/BIC', finding: `Invalid Debtor BIC "${dbtrBic}" in PmtInf ${pmtInfId || msgIndex}: ${bv.reason}.` });
          }
        }

        for (const txNode of txNodes) {
          const instrId = pathText(txNode, 'PmtId', 'InstrId');
          const endToEndId = pathText(txNode, 'PmtId', 'EndToEndId');
          const uetr = pathText(txNode, 'PmtId', 'UETR');
          const instdAmtNode = pathNode(txNode, 'Amt', 'InstdAmt') || pathNode(txNode, 'Amt', 'EqvtAmt', 'Amt');
          const amount = instdAmtNode ? parseAmount(instdAmtNode.text) : null;
          const currency = instdAmtNode ? (instdAmtNode.attrs.Ccy || dbtrAcct.currency || '') : '';
          const cdtrName = pathText(txNode, 'Cdtr', 'Nm');
          const cdtrAcct = extractAccountId(child(txNode, 'CdtrAcct'));
          const cdtrBic = extractBic(child(txNode, 'CdtrAgt'));
          const remittance = extractRemittance(child(txNode, 'RmtInf'));
          const purpose = pathText(txNode, 'Purp', 'Cd');

          if (amount != null) pmtSum += amount;

          const tx = {
            line: txNode.line,
            batchId: pmtInfId,
            pmtMtd,
            instrId,
            endToEndId,
            uetr,
            direction: 'DBIT',
            amount: amount != null ? amount : 0,
            signedAmount: amount != null ? -amount : 0,
            currency,
            valueDate: reqdDt,
            debtorName: dbtrName,
            debtorIban: dbtrAcct.iban || dbtrAcct.otherId,
            debtorBic: dbtrBic,
            creditorName: cdtrName,
            creditorIban: cdtrAcct.iban || cdtrAcct.otherId,
            creditorBic: cdtrBic,
            remittance,
            purpose,
            status: 'INIT',
            ibanValid: dbtrIbanOk,
            hasIssue: !dbtrIbanOk,
          };
          checkIbanAndBic(cdtrAcct.iban, cdtrBic, 'Creditor', txNode.line, tx);
          recordTx(tx);
        }

        if (pmtNbDecl != null && pmtNbDecl !== txNodes.length) {
          findings.push({
            severity: 'error',
            msgIndex,
            line: pmt.line,
            field: 'PmtInf/NbOfTxs',
            finding: `PmtInf "${pmtInfId}" NbOfTxs mismatch: declared ${pmtNbDecl}, found ${txNodes.length}.`,
          });
        }
        if (pmtCtrlDecl != null && Math.abs(round2(pmtSum) - round2(pmtCtrlDecl)) > 0.005) {
          findings.push({
            severity: 'error',
            msgIndex,
            line: pmt.line,
            field: 'PmtInf/CtrlSum',
            finding: `PmtInf "${pmtInfId}" CtrlSum mismatch: declared ${pmtCtrlDecl.toFixed(2)}, computed ${pmtSum.toFixed(2)} (delta ${(pmtSum - pmtCtrlDecl).toFixed(2)}).`,
          });
        }
      }
    } else if (bodyNode && (msgType === 'pacs.008' || bodyNode.name === 'FIToFICstmrCdtTrf')) {
      const txNodes = children(bodyNode, 'CdtTrfTxInf');
      for (const txNode of txNodes) {
        const instrId = pathText(txNode, 'PmtId', 'InstrId');
        const endToEndId = pathText(txNode, 'PmtId', 'EndToEndId');
        const txId = pathText(txNode, 'PmtId', 'TxId');
        const uetr = pathText(txNode, 'PmtId', 'UETR');
        const sttlmNode = child(txNode, 'IntrBkSttlmAmt');
        const amount = sttlmNode ? parseAmount(sttlmNode.text) : null;
        const currency = sttlmNode ? (sttlmNode.attrs.Ccy || ttlSttlmCcy || '') : '';
        const sttlmDt = pathText(txNode, 'IntrBkSttlmDt');
        const dbtrName = pathText(txNode, 'Dbtr', 'Nm');
        const dbtrAcct = extractAccountId(child(txNode, 'DbtrAcct'));
        const dbtrBic = extractBic(child(txNode, 'DbtrAgt'));
        const cdtrName = pathText(txNode, 'Cdtr', 'Nm');
        const cdtrAcct = extractAccountId(child(txNode, 'CdtrAcct'));
        const cdtrBic = extractBic(child(txNode, 'CdtrAgt'));
        const remittance = extractRemittance(child(txNode, 'RmtInf'));
        const purpose = pathText(txNode, 'Purp', 'Cd');

        const tx = {
          line: txNode.line,
          batchId: txId || '',
          pmtMtd: sttlmMtd || 'CLRG',
          instrId,
          endToEndId,
          uetr,
          direction: 'TRF',
          amount: amount != null ? amount : 0,
          signedAmount: amount != null ? amount : 0,
          currency,
          valueDate: sttlmDt,
          debtorName: dbtrName,
          debtorIban: dbtrAcct.iban || dbtrAcct.otherId,
          debtorBic: dbtrBic,
          creditorName: cdtrName,
          creditorIban: cdtrAcct.iban || cdtrAcct.otherId,
          creditorBic: cdtrBic,
          remittance,
          purpose,
          status: 'SETTLE',
          ibanValid: true,
          hasIssue: false,
        };
        checkIbanAndBic(dbtrAcct.iban, dbtrBic, 'Debtor', txNode.line, tx);
        checkIbanAndBic(cdtrAcct.iban, cdtrBic, 'Creditor', txNode.line, tx);
        recordTx(tx);
      }
    } else if (bodyNode && (msgType === 'camt.053' || msgType === 'camt.054' || bodyNode.name === 'BkToCstmrStmt' || bodyNode.name === 'BkToCstmrDbtCdtNtfctn')) {
      const stmtNodes = children(bodyNode, 'Stmt').concat(children(bodyNode, 'Ntfctn'));
      for (const stmt of stmtNodes) {
        const stmtId = pathText(stmt, 'Id');
        const acct = extractAccountId(child(stmt, 'Acct'));
        const acctBic = extractBic(pathNode(stmt, 'Acct', 'Svcr'));
        const acctOwner = pathText(stmt, 'Acct', 'Ownr', 'Nm');

        if (acct.iban) {
          ibanChecked += 1;
          const av = validateIban(acct.iban);
          if (!av.valid) {
            ibanFailed += 1;
            findings.push({ severity: 'error', msgIndex, line: stmt.line, field: 'Stmt/Acct/IBAN', finding: `Invalid Statement Account IBAN "${acct.iban}": ${av.reason}.` });
          }
        }

        let opBal = null;
        let clBal = null;
        for (const b of children(stmt, 'Bal')) {
          const code = pathText(b, 'Tp', 'CdOrPrtry', 'Cd');
          const amtNode = child(b, 'Amt');
          const amt = amtNode ? parseAmount(amtNode.text) : null;
          const ccy = amtNode ? (amtNode.attrs.Ccy || acct.currency || '') : '';
          const cdtDbt = pathText(b, 'CdtDbtInd');
          const dt = pathText(b, 'Dt', 'Dt') || pathText(b, 'Dt', 'DtTm');
          const signed = amt != null ? (cdtDbt === 'DBIT' ? -amt : amt) : null;
          const balObj = { stmtId, code, cdtDbt, amount: amt, signedAmount: signed, currency: ccy, date: dt };
          balances.push(balObj);
          if ((code === 'OPBD' || code === 'PRCD') && opBal == null) opBal = balObj;
          if ((code === 'CLBD' || code === 'CLAV') && clBal == null) clBal = balObj;
        }

        const ntrys = children(stmt, 'Ntry');
        let netEntries = 0;
        for (const ntry of ntrys) {
          const ntryRef = pathText(ntry, 'NtryRef');
          const amtNode = child(ntry, 'Amt');
          const amount = amtNode ? parseAmount(amtNode.text) : null;
          const currency = amtNode ? (amtNode.attrs.Ccy || acct.currency || '') : '';
          const cdtDbt = pathText(ntry, 'CdtDbtInd') || 'CRDT';
          const signedAmount = amount != null ? (cdtDbt === 'DBIT' ? -amount : amount) : 0;
          netEntries += signedAmount;
          const sts = pathText(ntry, 'Sts', 'Cd') || pathText(ntry, 'Sts');
          const valDt = pathText(ntry, 'ValDt', 'Dt') || pathText(ntry, 'BookgDt', 'Dt') || pathText(ntry, 'BookgDt', 'DtTm');
          const txDtls = pathNode(ntry, 'NtryDtls', 'TxDtls');
          const endToEndId = pathText(txDtls, 'Refs', 'EndToEndId') || ntryRef;
          const instrId = pathText(txDtls, 'Refs', 'InstrId') || ntryRef;
          const uetr = pathText(txDtls, 'Refs', 'UETR');
          const rltdPties = child(txDtls, 'RltdPties');
          const rltdAgts = child(txDtls, 'RltdAgts');

          const dbtrName = pathText(rltdPties, 'Dbtr', 'Pty', 'Nm') || pathText(rltdPties, 'Dbtr', 'Nm') || (cdtDbt === 'DBIT' ? acctOwner : '');
          const dbtrAcct = extractAccountId(child(rltdPties, 'DbtrAcct'));
          const dbtrBic = extractBic(child(rltdAgts, 'DbtrAgt')) || (cdtDbt === 'DBIT' ? acctBic : '');
          const cdtrName = pathText(rltdPties, 'Cdtr', 'Pty', 'Nm') || pathText(rltdPties, 'Cdtr', 'Nm') || (cdtDbt === 'CRDT' ? acctOwner : '');
          const cdtrAcct = extractAccountId(child(rltdPties, 'CdtrAcct'));
          const cdtrBic = extractBic(child(rltdAgts, 'CdtrAgt')) || (cdtDbt === 'CRDT' ? acctBic : '');
          const remittance = extractRemittance(child(txDtls, 'RmtInf')) || pathText(ntry, 'AddtlNtryInf');

          const tx = {
            line: ntry.line,
            batchId: stmtId,
            pmtMtd: 'STMT',
            instrId,
            endToEndId,
            uetr,
            direction: cdtDbt,
            amount: amount != null ? amount : 0,
            signedAmount,
            currency,
            valueDate: valDt,
            debtorName: dbtrName,
            debtorIban: dbtrAcct.iban || dbtrAcct.otherId || (cdtDbt === 'DBIT' ? acct.iban : ''),
            debtorBic: dbtrBic,
            creditorName: cdtrName,
            creditorIban: cdtrAcct.iban || cdtrAcct.otherId || (cdtDbt === 'CRDT' ? acct.iban : ''),
            creditorBic: cdtrBic,
            remittance,
            purpose: '',
            status: sts || 'BOOK',
            ibanValid: true,
            hasIssue: false,
          };
          checkIbanAndBic(dbtrAcct.iban, dbtrBic, 'Debtor', ntry.line, tx);
          checkIbanAndBic(cdtrAcct.iban, cdtrBic, 'Creditor', ntry.line, tx);
          recordTx(tx);
        }

        if (opBal && clBal && opBal.signedAmount != null && clBal.signedAmount != null) {
          const expectedCl = round2(opBal.signedAmount + netEntries);
          const actualCl = round2(clBal.signedAmount);
          if (Math.abs(expectedCl - actualCl) > 0.005) {
            findings.push({
              severity: 'error',
              msgIndex,
              line: stmt.line,
              field: 'Stmt/Bal',
              finding: `Statement "${stmtId}" balance mismatch: Opening ${opBal.signedAmount.toFixed(2)} + net entries ${netEntries.toFixed(2)} = ${expectedCl.toFixed(2)}, but Closing (${clBal.code}) is ${actualCl.toFixed(2)}.`,
            });
          }
        }
      }
    }

    const computedSum = round2(msgTxs.reduce((acc, t) => acc + t.amount, 0));
    const computedCount = msgTxs.length;
    const expectedSum = ctrlSumDeclared != null ? ctrlSumDeclared : ttlSttlmAmt;

    let nbOfTxsOk = true;
    if (nbOfTxsDeclared != null && nbOfTxsDeclared !== computedCount) {
      nbOfTxsOk = false;
      findings.push({
        severity: 'error',
        msgIndex,
        line: grpHdr ? grpHdr.line : docNode.line,
        field: 'GrpHdr/NbOfTxs',
        finding: `GrpHdr NbOfTxs mismatch in ${msgId || `MSG-${msgIndex}`}: declared ${nbOfTxsDeclared}, actual ${computedCount}.`,
      });
    }

    let ctrlSumOk = true;
    if (expectedSum != null && Math.abs(computedSum - round2(expectedSum)) > 0.005) {
      ctrlSumOk = false;
      findings.push({
        severity: 'error',
        msgIndex,
        line: grpHdr ? grpHdr.line : docNode.line,
        field: ctrlSumDeclared != null ? 'GrpHdr/CtrlSum' : 'GrpHdr/TtlIntrBkSttlmAmt',
        finding: `Control sum mismatch in ${msgId || `MSG-${msgIndex}`}: declared ${expectedSum.toFixed(2)}, computed ${computedSum.toFixed(2)} (delta ${(computedSum - expectedSum).toFixed(2)}).`,
      });
    }

    if (expectedSum != null && msgCurrencies.size > 1) {
      findings.push({
        severity: 'warning',
        msgIndex,
        line: grpHdr ? grpHdr.line : docNode.line,
        field: 'Ccy',
        finding: `Message ${msgId || `MSG-${msgIndex}`} mixes multiple currencies (${[...msgCurrencies].join(', ')}) under a single control sum.`,
      });
    }

    messages.push({
      index: msgIndex,
      id: msgId || `MSG-${msgIndex}`,
      msgType,
      msgTypeName,
      schema,
      creDtTm,
      initgPty,
      nbOfTxsDeclared,
      nbOfTxsActual: computedCount,
      nbOfTxsOk,
      ctrlSumDeclared: expectedSum,
      ctrlSumActual: computedSum,
      ctrlSumOk,
      currencies: [...msgCurrencies],
      ibanChecked,
      ibanFailed,
      balances,
    });
  });

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;

  return {
    messages,
    transactions,
    findings,
    typeCounts,
    currencyCounts,
    stats: {
      messageCount: messages.length,
      transactionCount: transactions.length,
      totalAmount: round2(transactions.reduce((s, t) => s + t.amount, 0)),
      currencies: Object.keys(currencyCounts),
      errorCount,
      warningCount,
    },
  };
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildTransactionsCsv(parsed, fileName) {
  const header = [
    'file', 'index', 'msg_id', 'msg_type', 'batch_id', 'end_to_end_id', 'instr_id', 'uetr',
    'direction', 'amount', 'currency', 'value_date', 'debtor_name', 'debtor_iban', 'debtor_bic',
    'creditor_name', 'creditor_iban', 'creditor_bic', 'remittance', 'status', 'iban_valid',
  ];
  const lines = [header.join(',')];
  for (const t of parsed.transactions) {
    lines.push([
      fileName, t.index, t.msgId, t.msgType, t.batchId, t.endToEndId, t.instrId, t.uetr,
      t.direction, t.amount.toFixed(2), t.currency, t.valueDate, t.debtorName, t.debtorIban, t.debtorBic,
      t.creditorName, t.creditorIban, t.creditorBic, t.remittance, t.status, t.ibanValid ? 'true' : 'false',
    ].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function buildHeadersCsv(parsed, fileName) {
  const header = [
    'file', 'msg_index', 'msg_id', 'msg_type', 'msg_type_name', 'created_at', 'initiating_party',
    'nb_of_txs_declared', 'nb_of_txs_actual', 'nb_of_txs_ok', 'ctrl_sum_declared', 'ctrl_sum_actual',
    'ctrl_sum_ok', 'currencies', 'iban_checked', 'iban_failed',
  ];
  const lines = [header.join(',')];
  for (const m of parsed.messages) {
    lines.push([
      fileName, m.index, m.id, m.msgType, m.msgTypeName, m.creDtTm, m.initgPty,
      m.nbOfTxsDeclared != null ? m.nbOfTxsDeclared : '', m.nbOfTxsActual, m.nbOfTxsOk ? 'true' : 'false',
      m.ctrlSumDeclared != null ? m.ctrlSumDeclared.toFixed(2) : '', m.ctrlSumActual.toFixed(2),
      m.ctrlSumOk ? 'true' : 'false', m.currencies.join(';'), m.ibanChecked, m.ibanFailed,
    ].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function buildIso20022Json(parsed, fileName) {
  return `${JSON.stringify({
    file: fileName,
    stats: parsed.stats,
    messages: parsed.messages,
    transactions: parsed.transactions,
    findings: parsed.findings,
  }, null, 2)}\n`;
}

function buildAuditMarkdown(entries) {
  const lines = ['# ISO 20022 Control-Total & IBAN Audit Report', ''];
  let totalMsgs = 0;
  let totalTxs = 0;
  let totalErrors = 0;
  let totalWarnings = 0;
  const globalMsgIds = new Map();

  for (const { fileName, parsed } of entries) {
    totalMsgs += parsed.stats.messageCount;
    totalTxs += parsed.stats.transactionCount;
    totalErrors += parsed.stats.errorCount;
    totalWarnings += parsed.stats.warningCount;
    for (const m of parsed.messages) {
      if (!globalMsgIds.has(m.id)) globalMsgIds.set(m.id, []);
      globalMsgIds.get(m.id).push(fileName);
    }
  }

  const crossDupes = [...globalMsgIds.entries()].filter(([, files]) => files.length > 1);

  lines.push(`- Files checked: ${entries.length}`);
  lines.push(`- Total messages: ${totalMsgs}`);
  lines.push(`- Total payments / entries: ${totalTxs}`);
  lines.push(`- Errors: ${totalErrors}`);
  lines.push(`- Warnings: ${totalWarnings}`);
  lines.push(`- Duplicate MsgId across checked files: ${crossDupes.length}`);
  lines.push('');
  lines.push('## Message Control-Total Summary');
  lines.push('');
  lines.push('| File | MsgId | Type | NbOfTxs (Decl / Act) | CtrlSum (Decl / Act) | Currencies | IBAN MOD-97 | Status |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');

  for (const { fileName, parsed } of entries) {
    for (const m of parsed.messages) {
      const nbStr = `${m.nbOfTxsDeclared != null ? m.nbOfTxsDeclared : '-'} / ${m.nbOfTxsActual}`;
      const sumStr = `${m.ctrlSumDeclared != null ? m.ctrlSumDeclared.toFixed(2) : '-'} / ${m.ctrlSumActual.toFixed(2)}`;
      const ibanStr = `${m.ibanChecked - m.ibanFailed}/${m.ibanChecked} OK`;
      const ok = m.nbOfTxsOk && m.ctrlSumOk && m.ibanFailed === 0;
      const status = ok ? 'PASS' : 'MISMATCH';
      lines.push(`| ${fileName} | ${m.id} | ${m.msgType} | ${nbStr} | ${sumStr} | ${m.currencies.join(', ') || '-'} | ${ibanStr} | ${status} |`);
    }
  }

  const allFindings = [];
  for (const { fileName, parsed } of entries) {
    for (const f of parsed.findings) {
      allFindings.push({ fileName, ...f });
    }
  }
  for (const [id, files] of crossDupes) {
    allFindings.push({ fileName: files.join(', '), severity: 'warning', line: 0, field: 'GrpHdr/MsgId', finding: `Duplicate MsgId "${id}" found in ${files.length} files.` });
  }

  lines.push('');
  lines.push('## Validation Findings');
  lines.push('');
  if (!allFindings.length) {
    lines.push('All CtrlSum, NbOfTxs, IBAN MOD-97, currency and MsgId uniqueness checks passed.');
  } else {
    lines.push('| File | Severity | Line | Field | Finding |');
    lines.push('| --- | --- | ---: | --- | --- |');
    for (const f of allFindings) {
      lines.push(`| ${f.fileName} | ${f.severity.toUpperCase()} | ${f.line} | ${f.field} | ${f.finding.replace(/\|/g, '\\|')} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function txKey(t, idx) {
  if (t.endToEndId && t.endToEndId.toUpperCase() !== 'NOTPROVIDED') return `${t.msgType}::${t.endToEndId}`;
  if (t.instrId) return `${t.msgType}::${t.instrId}`;
  return `${t.msgType}::#${idx + 1}`;
}

function buildBatchDiffMarkdown(leftName, leftParsed, rightName, rightParsed) {
  const lines = ['# ISO 20022 Payment Batch Comparison Report', ''];
  lines.push(`- Left file: \`${leftName}\` (${leftParsed.stats.messageCount} messages, ${leftParsed.stats.transactionCount} transactions, total ${leftParsed.stats.totalAmount.toFixed(2)})`);
  lines.push(`- Right file: \`${rightName}\` (${rightParsed.stats.messageCount} messages, ${rightParsed.stats.transactionCount} transactions, total ${rightParsed.stats.totalAmount.toFixed(2)})`);
  lines.push('');

  const leftMap = new Map();
  const rightMap = new Map();
  leftParsed.transactions.forEach((t, i) => leftMap.set(txKey(t, i), t));
  rightParsed.transactions.forEach((t, i) => rightMap.set(txKey(t, i), t));

  const added = [];
  const removed = [];
  const changed = [];
  let unchanged = 0;

  const COMPARE_FIELDS = [
    ['amount', 'Amount'],
    ['currency', 'Currency'],
    ['direction', 'Direction'],
    ['debtorName', 'Debtor'],
    ['debtorIban', 'Debtor IBAN'],
    ['debtorBic', 'Debtor BIC'],
    ['creditorName', 'Creditor'],
    ['creditorIban', 'Creditor IBAN'],
    ['creditorBic', 'Creditor BIC'],
    ['valueDate', 'Value Date'],
    ['remittance', 'Remittance'],
  ];

  for (const [k, ltx] of leftMap.entries()) {
    if (!rightMap.has(k)) {
      removed.push({ key: k, tx: ltx });
    } else {
      const rtx = rightMap.get(k);
      const diffs = [];
      for (const [prop, label] of COMPARE_FIELDS) {
        const lv = prop === 'amount' ? ltx[prop].toFixed(2) : String(ltx[prop] || '');
        const rv = prop === 'amount' ? rtx[prop].toFixed(2) : String(rtx[prop] || '');
        if (lv !== rv) diffs.push({ field: label, left: lv, right: rv });
      }
      if (diffs.length) changed.push({ key: k, diffs });
      else unchanged += 1;
    }
  }
  for (const [k, rtx] of rightMap.entries()) {
    if (!leftMap.has(k)) added.push({ key: k, tx: rtx });
  }

  lines.push(`- Unchanged: ${unchanged}`);
  lines.push(`- Changed: ${changed.length}`);
  lines.push(`- Added in right: ${added.length}`);
  lines.push(`- Removed from left: ${removed.length}`);
  lines.push('');

  if (changed.length) {
    lines.push('## Changed Transactions');
    lines.push('');
    lines.push('| Key | Field | Left | Right |');
    lines.push('| --- | --- | --- | --- |');
    for (const c of changed) {
      for (const d of c.diffs) {
        lines.push(`| ${c.key} | ${d.field} | ${d.left.replace(/\|/g, '\\|')} | ${d.right.replace(/\|/g, '\\|')} |`);
      }
    }
    lines.push('');
  }

  if (added.length) {
    lines.push('## Added Transactions');
    lines.push('');
    lines.push('| Key | Amount | Currency | Creditor | Creditor IBAN |');
    lines.push('| --- | ---: | --- | --- | --- |');
    for (const a of added) {
      lines.push(`| ${a.key} | ${a.tx.amount.toFixed(2)} | ${a.tx.currency} | ${a.tx.creditorName} | ${a.tx.creditorIban} |`);
    }
    lines.push('');
  }

  if (removed.length) {
    lines.push('## Removed Transactions');
    lines.push('');
    lines.push('| Key | Amount | Currency | Creditor | Creditor IBAN |');
    lines.push('| --- | ---: | --- | --- | --- |');
    for (const r of removed) {
      lines.push(`| ${r.key} | ${r.tx.amount.toFixed(2)} | ${r.tx.currency} | ${r.tx.creditorName} | ${r.tx.creditorIban} |`);
    }
    lines.push('');
  }

  if (!changed.length && !added.length && !removed.length) {
    lines.push('Both ISO 20022 payment batches contain identical transactions.');
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = {
  parseXml,
  parseIso20022,
  validateIban,
  validateBic,
  buildTransactionsCsv,
  buildHeadersCsv,
  buildIso20022Json,
  buildAuditMarkdown,
  buildBatchDiffMarkdown,
};
