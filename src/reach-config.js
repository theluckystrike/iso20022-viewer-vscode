'use strict';
module.exports = {
  prefix: 'zovoIso20022',
  triesKey: 'zovoIso20022.proTrial',
  slot: '#protools',
  tools: [
    { id: 'auditControlTotals', title: 'Audit ISO 20022 control totals, IBAN MOD-97 and duplicate MsgId', command: 'zovoIso20022.auditControlTotals' },
    { id: 'exportCsvJson', title: 'Export ISO 20022 payments and entries to CSV and JSON', command: 'zovoIso20022.exportCsvJson' },
    { id: 'diffBatches', title: 'Compare ISO 20022 payment batches across two files', command: 'zovoIso20022.diffBatches' },
  ],
};
