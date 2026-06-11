import { Router } from "express";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

const router = Router();

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */

/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Authentication endpoints
 *   - name: Businesses
 *     description: Business profile management
 *   - name: Parties
 *     description: Customers and Suppliers management nested under businesses
 *   - name: Items
 *     description: Products and services stock management nested under businesses
 *   - name: Invoices
 *     description: Invoicing and sales/purchases management nested under businesses
 *   - name: Payments
 *     description: Client payments in and out management nested under businesses
 *   - name: Expenses
 *     description: Business expenditure logging nested under businesses
 *   - name: Dashboard
 *     description: Business summary, financial and inventory reports nested under businesses
 */

/**
 * @swagger
 * /v1/auth/signup:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password, confirmPassword]
 *             properties:
 *               name: { type: string, example: "John Doe" }
 *               email: { type: string, format: email, example: "john@example.com" }
 *               password: { type: string, minLength: 6, example: "password123" }
 *               confirmPassword: { type: string, example: "password123" }
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Validation error
 *
 * /v1/auth/login:
 *   post:
 *     summary: Login a user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: "john@example.com" }
 *               password: { type: string, example: "password123" }
 *     responses:
 *       200:
 *         description: Login successful, returns tokens
 *       401:
 *         description: Invalid credentials
 *
 * /v1/auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refresh_token]
 *             properties:
 *               refresh_token: { type: string }
 *     responses:
 *       200:
 *         description: New tokens generated
 *
 * /v1/auth/logout:
 *   post:
 *     summary: Logout user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *               allDevices: { type: boolean, default: false }
 *     responses:
 *       200:
 *         description: Logout successful
 *
 * /v1/auth/me:
 *   get:
 *     summary: Get current user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user data
 */

/**
 * @swagger
 * /v1/businesses:
 *   post:
 *     summary: Create a new business
 *     tags: [Businesses]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, address, city, state, pincode, business_type, invoice_prefix, financial_year]
 *             properties:
 *               name: { type: string, example: "Vyapar LLC" }
 *               email: { type: string, format: email, example: "info@vyapar.com" }
 *               phone: { type: string, example: "+919999999999" }
 *               address: { type: string, example: "123 Business Park" }
 *               city: { type: string, example: "Mumbai" }
 *               state: { type: string, example: "Maharashtra" }
 *               pincode: { type: string, example: "400001" }
 *               gstin: { type: string, pattern: "^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$", example: "27AAAAA1111A1Z1" }
 *               pan_number: { type: string, example: "ABCDE1234F" }
 *               business_type: { type: string, enum: [retailer, wholesaler, service], example: "retailer" }
 *               invoice_prefix: { type: string, example: "INV" }
 *               financial_year: { type: string, example: "2026-2027" }
 *     responses:
 *       201:
 *         description: Business created successfully
 *       400:
 *         description: Validation error
 *   get:
 *     summary: List all businesses for current user
 *     tags: [Businesses]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of businesses
 */

/**
 * @swagger
 * /v1/businesses/{businessId}:
 *   get:
 *     summary: Get business by ID
 *     tags: [Businesses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Business details
 *       404:
 *         description: Business not found
 *   put:
 *     summary: Update business by ID
 *     tags: [Businesses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               address: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *               pincode: { type: string }
 *               gstin: { type: string }
 *               pan_number: { type: string }
 *     responses:
 *       200:
 *         description: Business updated successfully
 *       404:
 *         description: Business not found
 *   delete:
 *     summary: Delete business by ID
 *     tags: [Businesses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Business deleted successfully
 *       404:
 *         description: Business not found
 */

/**
 * @swagger
 * /v1/businesses/{businessId}/parties:
 *   post:
 *     summary: Create a customer or supplier party
 *     tags: [Parties]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, party_type]
 *             properties:
 *               name: { type: string, example: "Acme Corp" }
 *               phone: { type: string, example: "9876543210" }
 *               email: { type: string, format: email, example: "billing@acme.com" }
 *               gstin: { type: string }
 *               billing_address: { type: string }
 *               shipping_address: { type: string }
 *               party_type: { type: string, enum: [customer, supplier, both], example: "customer" }
 *               opening_balance: { type: number, default: 0 }
 *               opening_balance_type: { type: string, enum: [receive, pay], default: "receive" }
 *     responses:
 *       201:
 *         description: Party created successfully
 *   get:
 *     summary: List all parties for a business
 *     tags: [Parties]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: List of parties
 */

/**
 * @swagger
 * /v1/businesses/{businessId}/parties/{partyId}:
 *   get:
 *     summary: Get party details by ID
 *     tags: [Parties]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: partyId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Party details
 *   put:
 *     summary: Update party details
 *     tags: [Parties]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: partyId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               email: { type: string }
 *               billing_address: { type: string }
 *               shipping_address: { type: string }
 *               current_balance: { type: number }
 *     responses:
 *       200:
 *         description: Party updated successfully
 *   delete:
 *     summary: Delete party
 *     tags: [Parties]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: partyId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Party deleted successfully
 */

/**
 * @swagger
 * /v1/businesses/{businessId}/items:
 *   post:
 *     summary: Create a product or service item
 *     tags: [Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, item_type]
 *             properties:
 *               name: { type: string, example: "Wireless Mouse" }
 *               item_type: { type: string, enum: [product, service], example: "product" }
 *               sku: { type: string, example: "MOU-001" }
 *               hsn_code: { type: string, example: "8471" }
 *               sales_price: { type: number, example: 500 }
 *               purchase_price: { type: number, example: 300 }
 *               tax_rate: { type: number, example: 18 }
 *               is_tax_inclusive: { type: boolean, default: false }
 *               measuring_unit: { type: string, default: "pcs" }
 *               opening_stock: { type: number, default: 0 }
 *               low_stock_warning: { type: number, default: 5 }
 *     responses:
 *       201:
 *         description: Item created successfully
 *   get:
 *     summary: List items for a business
 *     tags: [Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of items
 */

/**
 * @swagger
 * /v1/businesses/{businessId}/items/{itemId}:
 *   get:
 *     summary: Get item by ID
 *     tags: [Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Item details
 *   put:
 *     summary: Update item details
 *     tags: [Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               sales_price: { type: number }
 *               purchase_price: { type: number }
 *               tax_rate: { type: number }
 *               low_stock_warning: { type: number }
 *     responses:
 *       200:
 *         description: Item updated successfully
 *   delete:
 *     summary: Delete item
 *     tags: [Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Item deleted successfully
 */

/**
 * @swagger
 * /v1/businesses/{businessId}/items/{itemId}/adjust-stock:
 *   post:
 *     summary: Adjust stock manually (add or reduce)
 *     tags: [Items]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quantity]
 *             properties:
 *               quantity: { type: number, description: "Positive value (addition) or negative value (reduction)", example: 10 }
 *               notes: { type: string, example: "Manual restock" }
 *     responses:
 *       200:
 *         description: Stock adjusted successfully
 */

/**
 * @swagger
 * /v1/businesses/{businessId}/invoices:
 *   post:
 *     summary: Create a sale, purchase, sale_return, or purchase_return invoice
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [invoice_number, invoice_type, payment_mode, items]
 *             properties:
 *               party_id: { type: string, format: uuid }
 *               invoice_number: { type: string, example: "INV-2026-001" }
 *               invoice_type: { type: string, enum: [sale, purchase, sale_return, purchase_return], example: "sale" }
 *               invoice_date: { type: string, format: date-time }
 *               due_date: { type: string, format: date-time }
 *               discount_amount: { type: number, default: 0 }
 *               paid_amount: { type: number, default: 0 }
 *               payment_mode: { type: string, enum: [cash, bank, upi, credit, multiple], example: "cash" }
 *               notes: { type: string }
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [name, quantity, unit_price]
 *                   properties:
 *                     item_id: { type: string, format: uuid }
 *                     name: { type: string, example: "Wireless Mouse" }
 *                     quantity: { type: number, example: 2 }
 *                     unit_price: { type: number, example: 500 }
 *                     discount_percentage: { type: number, default: 0 }
 *                     tax_rate: { type: number, default: 18 }
 *     responses:
 *       201:
 *         description: Invoice created successfully
 *   get:
 *     summary: List all invoices for a business
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of invoices
 */

/**
 * @swagger
 * /v1/businesses/{businessId}/invoices/{invoiceId}:
 *   get:
 *     summary: Get invoice details including item list by ID
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: invoiceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Invoice details and items
 *   put:
 *     summary: Update invoice details (restricted updates)
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: invoiceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes: { type: string }
 *               due_date: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Invoice updated successfully
 *   delete:
 *     summary: Delete invoice (reverts stock changes and balances)
 *     tags: [Invoices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: invoiceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Invoice deleted successfully
 */

/**
 * @swagger
 * /v1/businesses/{businessId}/payments:
 *   post:
 *     summary: Record client payment in or payment out
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [party_id, payment_type, amount, payment_mode]
 *             properties:
 *               party_id: { type: string, format: uuid }
 *               payment_type: { type: string, enum: [payment_in, payment_out], example: "payment_in" }
 *               amount: { type: number, example: 1000 }
 *               payment_mode: { type: string, enum: [cash, bank, upi], example: "cash" }
 *               reference_number: { type: string, example: "TXN12345" }
 *               payment_date: { type: string, format: date-time }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Payment registered successfully
 *   get:
 *     summary: List all payments for a business
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of payments
 */

/**
 * @swagger
 * /v1/businesses/{businessId}/payments/{paymentId}:
 *   put:
 *     summary: Update payment details
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount: { type: number }
 *               payment_mode: { type: string, enum: [cash, bank, upi] }
 *               description: { type: string }
 *     responses:
 *       200:
 *         description: Payment updated successfully
 *   delete:
 *     summary: Delete payment (reverts party balance adjustments)
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Payment deleted successfully
 */

/**
 * @swagger
 * /v1/businesses/{businessId}/expenses:
 *   post:
 *     summary: Create an expense log
 *     tags: [Expenses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [expense_category, expense_number, total_amount, payment_mode]
 *             properties:
 *               expense_category: { type: string, example: "Office Supplies" }
 *               expense_number: { type: string, example: "EXP-101" }
 *               expense_date: { type: string, format: date-time }
 *               total_amount: { type: number, example: 1500 }
 *               paid_amount: { type: number, example: 1500 }
 *               payment_mode: { type: string, enum: [cash, bank, upi, credit], example: "cash" }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Expense logged successfully
 *   get:
 *     summary: List all expenses
 *     tags: [Expenses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of expenses
 */

/**
 * @swagger
 * /v1/businesses/{businessId}/expenses/{expenseId}:
 *   get:
 *     summary: Get expense details by ID
 *     tags: [Expenses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: expenseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Expense details
 *   put:
 *     summary: Update expense details
 *     tags: [Expenses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: expenseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               expense_category: { type: string }
 *               total_amount: { type: number }
 *               paid_amount: { type: number }
 *               payment_mode: { type: string, enum: [cash, bank, upi, credit] }
 *     responses:
 *       200:
 *         description: Expense updated successfully
 *   delete:
 *     summary: Delete expense log
 *     tags: [Expenses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: expenseId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Expense deleted successfully
 */

/**
 * @swagger
 * /v1/businesses/{businessId}/dashboard/summary:
 *   get:
 *     summary: Get dashboard statistics (sales, purchases, cash book balances)
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Summary metrics
 */

/**
 * @swagger
 * /v1/businesses/{businessId}/dashboard/reports/profit-loss:
 *   get:
 *     summary: Get Profit and Loss report
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Profit & loss report data
 */

/**
 * @swagger
 * /v1/businesses/{businessId}/dashboard/reports/stock-status:
 *   get:
 *     summary: Get stock status report for all products
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Stock status list
 */

/**
 * @swagger
 * /v1/businesses/{businessId}/dashboard/reports/party-ledger/{partyId}:
 *   get:
 *     summary: Get ledger details/statement of transactions for a specific party
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: partyId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Party ledger transactions
 */

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Vyapar Setu API Documentation",
      version: "1.0.0",
      description: "Interactive API reference for Vyapar Setu Bookkeeping & Ledger Backend",
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Local development server",
      },
    ],
  },
  apis: ["./src/swagger.js"],
};

const swaggerSpec = swaggerJSDoc(options);

router.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
router.get("/swagger.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

export default router;
