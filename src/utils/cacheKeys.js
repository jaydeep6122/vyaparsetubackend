/**
 * Centralized cache key generators for consistency and easy invalidation.
 */

export const cacheKeys = {
  // Dashboard
  dashboardSummary: (businessId) => `dashboard:summary:${businessId}`,
  dashboardProfitLoss: (businessId, fromDate = "", toDate = "") =>
    `dashboard:profitLoss:${businessId}:${fromDate}:${toDate}`,
  dashboardPartyLedger: (businessId, partyId) =>
    `dashboard:partyLedger:${businessId}:${partyId}`,
  dashboardStockStatus: (businessId) => `dashboard:stockStatus:${businessId}`,

  // Businesses
  businessList: (userId) => `businesses:list:${userId}`,
  businessDetail: (businessId) => `businesses:detail:${businessId}`,

  // Parties
  partyList: (businessId, partyType = "", search = "") =>
    `parties:list:${businessId}:${partyType}:${search}`,
  partyDetail: (businessId, partyId) =>
    `parties:detail:${businessId}:${partyId}`,

  // Items
  itemList: (businessId, search = "") => `items:list:${businessId}:${search}`,
  itemDetail: (businessId, itemId) => `items:detail:${businessId}:${itemId}`,

  // Invoices
  invoiceList: (businessId, queryParams = "") =>
    `invoices:list:${businessId}:${queryParams}`,
  invoiceDetail: (businessId, invoiceId) =>
    `invoices:detail:${businessId}:${invoiceId}`,

  // Payments
  paymentList: (businessId, queryParams = "") =>
    `payments:list:${businessId}:${queryParams}`,
  paymentDetail: (businessId, paymentId) =>
    `payments:detail:${businessId}:${paymentId}`,

  // Expenses
  expenseList: (businessId) => `expenses:list:${businessId}`,
  expenseDetail: (businessId, expenseId) =>
    `expenses:detail:${businessId}:${expenseId}`,
};
