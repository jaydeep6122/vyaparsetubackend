import express from "express";
import { getDashboardSummary } from "./summary/summary.controllers.js";
import { getProfitAndLoss } from "./profitLoss/profitLoss.controllers.js";
import { getStockStatusReport } from "./stockStatus/stockStatus.controllers.js";
import { getPartyLedgerReport } from "./partyLedger/partyLedger.controllers.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

const router = express.Router({ mergeParams: true });

router.get("/summary", asyncHandler(getDashboardSummary));
router.get("/reports/profit-loss", asyncHandler(getProfitAndLoss));
router.get("/reports/stock-status", asyncHandler(getStockStatusReport));
router.get("/reports/party-ledger/:partyId", asyncHandler(getPartyLedgerReport));

export default router;
