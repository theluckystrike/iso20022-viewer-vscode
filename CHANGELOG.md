# Changelog

## 0.1.0

- First release: ISO 20022 banking payment and statement XML files (`.iso20022`, `.pain001`, `.camt053`, `.pacs008`, `.sepa`) in a read-only viewer, parsed locally with plain JavaScript.
- Supports `pain.001` (Customer Credit Transfer), `pacs.008` (FI-to-FI Credit Transfer), `camt.053` (Bank-to-Customer Statement) and `camt.054` (Debit/Credit Notification).
- Group header (`GrpHdr`) summary, payment and statement entry table (IBAN, BIC, amount, currency, debtor, creditor, remittance info), detail inspector, local search and filter, and `CtrlSum`, `NbOfTxs` and IBAN MOD-97 validation checks.
- Zovo Pro tools with 1 free try each: control-total and IBAN MOD-97 Markdown audit report, non-destructive CSV and JSON export, and two-file ISO 20022 payment batch comparison. Get Zovo Pro first shows what Pro includes and the tries left, in an editor tab.
