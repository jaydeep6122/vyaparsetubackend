import { Router } from "express";
import { loadBusiness, requireAuth, requireRole } from "../../middlewares/auth.middlewares.js";
import { idParams } from "../../middlewares/params.middlewares.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { context, created, ok } from "../../utils/http.js";
import accountsRouter from "../accounts/accounts.routes.js";
import { expenseCategoriesRouter, itemCategoriesRouter } from "../categories/categories.routes.js";
import expensesRouter from "../expenses/expenses.routes.js";
import invoicesRouter from "../invoices/invoices.routes.js";
import itemsRouter from "../items/items.routes.js";
import partiesRouter from "../parties/parties.routes.js";
import paymentsRouter from "../payments/payments.routes.js";
import reportsRouter from "../reports/reports.routes.js";
import stockAdjustmentsRouter from "../stock/stock-adjustments.routes.js";
import taxRatesRouter from "../tax-rates/tax-rates.routes.js";
import transfersRouter from "../transfers/transfers.routes.js";
import * as schemas from "./businesses.schemas.js";
import * as service from "./businesses.service.js";

const router = Router();
router.use(requireAuth);

router.post("/", validate(schemas.createBusinessSchema), async (req, res) => {
  created(res, await service.createBusiness(req.user, req.body));
});

router.get("/", async (req, res) => {
  ok(res, await service.listBusinesses(req.user.id));
});

// Everything below acts on one business the caller is an active member of.
const business = Router({ mergeParams: true });
router.use("/:businessId", loadBusiness, business);

business.get("/", (req, res) => {
  ok(res, { ...req.business, role: req.role });
});

business.patch("/", requireRole("admin"), validate(schemas.updateBusinessSchema), async (req, res) => {
  ok(res, await service.updateBusiness(context(req), req.body));
});

business.delete("/", requireRole("owner"), async (req, res) => {
  await service.archiveBusiness(context(req));
  ok(res, { archived: true });
});

business.get("/members", async (req, res) => {
  ok(res, await service.listMembers(context(req)));
});

business.patch(
  "/members/:userId",
  requireRole("admin"),
  idParams("userId"),
  validate(schemas.changeRoleSchema),
  async (req, res) => {
    ok(res, await service.changeMemberRole(context(req), req.params.userId, req.body.role));
  },
);

business.delete("/members/:userId", idParams("userId"), async (req, res) => {
  await service.removeMember(context(req), req.params.userId);
  ok(res, { removed: true });
});

business.get("/invites", requireRole("admin"), async (req, res) => {
  ok(res, await service.listInvites(context(req)));
});

business.post("/invites", requireRole("admin"), validate(schemas.inviteSchema), async (req, res) => {
  created(res, await service.createInvite(context(req), req.body));
});

business.delete("/invites/:inviteId", requireRole("admin"), idParams("inviteId"), async (req, res) => {
  await service.revokeInvite(context(req), req.params.inviteId);
  ok(res, { revoked: true });
});

business.get("/document-series", async (req, res) => {
  ok(res, await service.listSeries(context(req)));
});

business.patch(
  "/document-series/:seriesId",
  requireRole("admin"),
  idParams("seriesId"),
  validate(schemas.updateSeriesSchema),
  async (req, res) => {
    ok(res, await service.updateSeries(context(req), req.params.seriesId, req.body));
  },
);

business.use("/parties", partiesRouter);
business.use("/items", itemsRouter);
business.use("/item-categories", itemCategoriesRouter);
business.use("/expense-categories", expenseCategoriesRouter);
business.use("/tax-rates", taxRatesRouter);
business.use("/accounts", accountsRouter);
business.use("/invoices", invoicesRouter);
business.use("/payments", paymentsRouter);
business.use("/expenses", expensesRouter);
business.use("/transfers", transfersRouter);
business.use("/stock-adjustments", stockAdjustmentsRouter);
business.use("/reports", reportsRouter);

export default router;
