# Pending changes

Requests are logged here, not built. Nothing is built until James sends a build message. IDs are never reused.

## Pending

### P-1 - Link receipts from paperless-ngx to card transactions
Requested: 2026-10-31 (James: "is there a way to connect finance hub to paperless-ngx and cross reference credit card statement items with receipts to get a fuller picture of spending?")
Type: minor (new feature, new settings)        Status: Pending
Plan (first version):
- Settings `PAPERLESS_URL` (LAN, http://192.168.4.11:8073) and `PAPERLESS_TOKEN` (read-only API token, never in the repo or the browser). The server calls Paperless; receipt text is never sent to the browser, only matches and a link.
- Read documents from `/api/documents/`: date, correspondent, title, notes, and the total.
- Match each card transaction to a receipt by exact amount, date within a few days, and merchant similarity. Confident matches are linked; weaker ones go to a review list to accept or reject. Manual decisions are never overwritten (same rule as categories).
- Show a receipt link on matched transactions, a "no receipt" filter above an amount, and lists of unmatched receipts and unmatched charges.
- PayPal receipts are all under one "PayPal" correspondent, so the merchant must be read from the title or notes.
Later (separate release): split one charge across categories from receipt line items.
Notes / questions:
- Where does the receipt total come from? Best: the Outlook import writes it into a Paperless custom field. Otherwise it is read from the OCR text, which is less reliable (about 3,700 emails in "Purchases", some will have no clear total).
- Finance Hub is reachable through Cloudflare Access but the Paperless API is LAN-only: the container must reach 192.168.4.11:8073 directly (compose network or host route). Needs a check on the server.
- Currency handling for foreign receipts: match on the card-posted amount, or the receipt currency?

## Done
(none yet)
