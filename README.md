# VyaparSetu Backend

Express 5 + PostgreSQL API for GST and non-GST billing: parties, items and stock, invoices with transport details, payments, expenses, cash and bank accounts, multi-user businesses and reports.

## Setup

1. Node 20+ and PostgreSQL 13+.
2. Copy `.env.example` to `.env`. Point `DATABASE_URL` at a **new, empty** database and set `JWT_SECRET` (e.g. `openssl rand -hex 32`).
3. Install, create the schema and start:

   ```bash
   npm install
   npm run migrate
   npm run dev
   ```

## Tests

Tests run against `DATABASE_URL_TEST`, a separate throwaway database. They refuse to start if it is missing or if it equals `DATABASE_URL`. Migrations are applied to it automatically.

```bash
DATABASE_URL_TEST=postgres://localhost:5432/vyaparsetu_test npm test
```

## Database migrations

The schema lives only in `migrations/` and is managed with [node-pg-migrate](https://salsita.github.io/node-pg-migrate/). The server never changes tables when it starts.

| Command | What it does |
|---|---|
| `npm run migrate` | Apply pending migrations to `DATABASE_URL` |
| `npm run migrate:down` | Roll back the most recent migration |
| `npm run migrate:create -- <name>` | Create a new migration file |

**Deploys must run `npm run migrate` before `npm start`.**

Never edit a migration that has already been applied to a shared database. Add a new one instead.

## How the books work

- **Ledgers are the source of truth.** Party balances, cash/bank balances and stock are sums over `party_ledger_entries`, `account_entries` and `stock_movements`. No balance column is edited by hand.
- **`src/services/posting.js` is the only writer.** Creating, editing or cancelling a document deletes that document's ledger rows and writes them again from its current state.
- **All money received or paid is a row in `payments`.** That includes "paid now" on an invoice or expense. `payment_allocations` links a payment to the invoices, freight charges or expenses it settles. A trigger keeps `amount_settled` in sync, and CHECK constraints refuse over-payment.
- **Amounts never touch JS floats.** They arrive and leave as decimal strings (`"4720.00"`) and are computed with `decimal.js` (`src/utils/money.js`).
- **The database enforces the rules.** Totals must add up. Non-GST bills cannot carry tax. A row can only reference parties, items and accounts of its own business.

## API

All responses are JSON: `{ "success": true, "data": ..., "pagination"? }` or `{ "success": false, "statusCode", "message", "constraint"? }`.

Authenticated routes need `Authorization: Bearer <access_token>`. Business routes live under `/v1/businesses/:businessId` and are open only to active members. Roles rank **owner > admin > accountant > staff**.

| Area | Routes |
|---|---|
| Auth | `POST /v1/auth/signup`, `/login`, `/refresh`, `/logout` · `GET/PATCH /v1/auth/me` · `POST /v1/auth/me/password` · `POST /v1/auth/password/forgot`, `/password/reset` |
| Businesses | `POST/GET /v1/businesses` · `GET/PATCH/DELETE /:businessId` (DELETE archives) |
| Members | `GET /members` · `PATCH/DELETE /members/:userId` · `GET/POST /invites` · `DELETE /invites/:inviteId` · `POST /v1/invites/accept` |
| Numbering | `GET /document-series` · `PATCH /document-series/:seriesId` |
| Parties | `GET/POST /parties` · `GET/PATCH /parties/:id` · `POST /parties/:id/archive`, `/restore` · `GET /parties/:id/ledger` |
| Items | `GET/POST /items` · `GET/PATCH /items/:id` · `POST /items/:id/archive`, `/restore` |
| Masters | `/tax-rates`, `/item-categories`, `/expense-categories` |
| Accounts | `GET/POST /accounts` · `GET/PATCH /accounts/:id` · archive/restore · `GET /accounts/:id/book` |
| Invoices | `GET/POST /invoices` · `GET/PUT/DELETE /invoices/:id` (DELETE: drafts only) · `POST /invoices/:id/cancel` · `GET /invoices/:id/pdf` · `POST /invoices/:id/share`, `/email` |
| Public | `GET /v1/public/invoices/:token` (share links, no login) |
| Payments | `GET/POST /payments` · `GET/PUT /payments/:id` · `POST /payments/:id/cancel` |
| Expenses | `GET/POST /expenses` · `GET/PUT /expenses/:id` · `POST /expenses/:id/cancel` |
| Transfers | `GET/POST /transfers` · `POST /transfers/:id/cancel` |
| Stock | `GET/POST /stock-adjustments` · `GET /stock-adjustments/:id` · `POST /stock-adjustments/:id/cancel` |
| Reports | `/reports/dashboard`, `/profit-loss`, `/gst-summary`, `/outstanding`, `/day-book`, `/stock-summary`, `/party-ledger/:partyId`, `/account-book/:accountId` |

### Invoice essentials

- **`invoice_type`**: `sale`, `purchase`, `sale_return` or `purchase_return`.
- **`tax_mode`**:
  - `gst` gives a tax invoice with CGST+SGST within the business's state and IGST outside it.
  - `non_gst` gives a bill of supply or cash memo with no tax and its own number series (`BILL/…`).
  - The default is `gst` for regular GST businesses and `non_gst` otherwise.
- **Lines** take an `item_id` (the name, HSN, unit, price and GST rate come from the item) or free text with a `unit_price`. Discounts are applied before tax. `price_includes_tax` back-calculates tax.
- **Transport and delivery**: `vehicle_no`, `driver_name`, `driver_phone`, `transport_mode`, `lr_no`, `eway_bill_no`, `chalan_no`, `delivery_date`, `dispatch_from`, `ship_to`.
- **`charges`** cover freight, loading, packing and similar. Pass `qty` + `rate` or an `amount`.
  - With a `payee_party_id` (e.g. a transporter), the charge is owed to that payee instead of being billed to the invoice party.
  - `paid_now` pays the payee straight away.
- **`payment`** records money received or paid with the invoice. A walk-in sale (no party) must be paid in full.
- **Editing and cancelling**: `PUT` sends the whole invoice again. A final invoice is cancelled, never deleted, and only after its payments are cancelled.

### Invoice PDF, sharing and email

- **`GET /invoices/:id/pdf`** returns an A4 PDF (add `?download=true` to download instead of viewing inline). The title follows the document type:
  - Tax invoice or bill of supply for sales.
  - Credit note for sale returns, debit note for purchase returns.
- **The PDF includes**:
  - business and party details
  - transport details
  - line items and charges
  - GST breakup by rate
  - amount in words
  - payments received and balance due
  - bank details, and a UPI QR code for the balance due
  - terms, and a signature line
- **Watermarks**: drafts and cancelled invoices are marked on every page.
- **`POST /invoices/:id/share`** returns a signed link that opens the PDF without logging in, plus a `whatsapp_url` with the message ready to send. Links last 30 days and cannot be revoked one by one. Set `PUBLIC_BASE_URL` so links use your public address.
- **`POST /invoices/:id/email`** emails the PDF to the party (or to `to`). This needs the SMTP settings.
- **Limitation**: PDFs use a Latin-only font. Names written in Gujarati, Hindi or other Indian scripts do not print correctly yet.

### Forgot password

1. `POST /v1/auth/password/forgot { email }` always answers the same way. If the account exists, a 6-digit code is emailed.
2. `POST /v1/auth/password/reset { email, code, new_password }` sets the new password, signs out every session, and returns a new session.

**Code rules**: a code expires after 15 minutes, allows 5 wrong attempts, and works once. A new code can be requested at most once a minute.

**Without SMTP** in development, the email (including the code) is printed to the server log.

## Email (SMTP)

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`. Any SMTP provider works (Gmail app password, Amazon SES, Brevo and others). Without them nothing is emailed; in production the server logs a warning at startup.
