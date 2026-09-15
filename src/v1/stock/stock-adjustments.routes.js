import { Router } from "express";
import { z } from "zod";
import pool from "../../db/db.js";
import { Filters, insertRows, pageResult } from "../../db/sql.js";
import { withTransaction } from "../../db/transaction.js";
import { requireRole } from "../../middlewares/auth.middlewares.js";
import { idParams } from "../../middlewares/params.middlewares.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { audit } from "../../services/audit.js";
import { postStockAdjustment } from "../../services/posting.js";
import { ApiError } from "../../utils/ApiError.js";
import { today } from "../../utils/fy.js";
import { context, created, ok, paged } from "../../utils/http.js";
import { dec } from "../../utils/money.js";
import { date, id, listQuery, optionalText, quantity, unitRate } from "../../utils/schemas.js";
import { cancelSchema } from "../payments/payments.schemas.js";

const adjustmentSchema = z.object({
  adjustment_date: date.optional(),
  reason: z.enum(["damage", "count", "opening", "other"]),
  notes: optionalText(500),
  lines: z
    .array(
      z.object({
        item_id: id,
        // Positive adds stock, negative removes it.
        quantity: quantity().refine((value) => !dec(value).isZero(), "Quantity cannot be zero"),
        unit_cost: unitRate().nullable().optional(),
      }),
    )
    .min(1, "An adjustment needs at least one line")
    .max(200),
});

const listAdjustmentsQuery = listQuery({
  status: z.enum(["active", "cancelled"]).optional(),
  from: date.optional(),
  to: date.optional(),
});

async function getAdjustment(db, businessId, adjustmentId) {
  const {
    rows: [adjustment],
  } = await db.query("SELECT * FROM stock_adjustments WHERE business_id = $1 AND id = $2", [
    businessId,
    adjustmentId,
  ]);
  if (!adjustment) throw new ApiError(404, "Stock adjustment not found");

  const { rows: lines } = await db.query(
    `SELECT l.id, l.item_id, i.name AS item_name, i.unit_code, l.quantity, l.unit_cost
     FROM stock_adjustment_lines l JOIN items i ON i.id = l.item_id
     WHERE l.adjustment_id = $1
     ORDER BY i.name`,
    [adjustmentId],
  );
  return { ...adjustment, lines };
}

const router = Router({ mergeParams: true });

router.get("/", validate(listAdjustmentsQuery, "query"), async (req, res) => {
  const query = req.query;
  const filters = new Filters().add("a.business_id = ?", req.business.id);
  filters.addIf(query.status, "a.status = ?", query.status);
  filters.addIf(query.from, "a.adjustment_date >= ?", query.from);
  filters.addIf(query.to, "a.adjustment_date <= ?", query.to);

  const { rows } = await pool.query(
    `SELECT a.*,
            (SELECT COUNT(*) FROM stock_adjustment_lines l WHERE l.adjustment_id = a.id) AS line_count,
            COUNT(*) OVER () AS total_count
     FROM stock_adjustments a
     ${filters.where}
     ORDER BY a.adjustment_date DESC, a.created_at DESC
     LIMIT ${filters.param(query.limit)} OFFSET ${filters.param(query.offset)}`,
    filters.values,
  );
  paged(res, pageResult(rows, query));
});

router.get("/:adjustmentId", idParams("adjustmentId"), async (req, res) => {
  ok(res, await getAdjustment(pool, req.business.id, req.params.adjustmentId));
});

router.post("/", requireRole("accountant"), validate(adjustmentSchema), async (req, res) => {
  const ctx = context(req);
  const adjustment = await withTransaction(async (client) => {
    const itemIds = [...new Set(req.body.lines.map((line) => line.item_id))];
    const { rowCount } = await client.query(
      `SELECT 1 FROM items
       WHERE business_id = $1 AND id = ANY($2::uuid[]) AND track_stock AND archived_at IS NULL`,
      [ctx.business.id, itemIds],
    );
    if (rowCount !== itemIds.length) {
      throw new ApiError(400, "Every line needs an active item that tracks stock");
    }

    const [{ id: adjustmentId }] = await insertRows(
      client,
      "stock_adjustments",
      ["business_id", "adjustment_date", "reason", "notes", "created_by"],
      [
        {
          ...req.body,
          business_id: ctx.business.id,
          adjustment_date: req.body.adjustment_date ?? today(),
          created_by: ctx.user.id,
        },
      ],
      "id",
    );
    await insertRows(
      client,
      "stock_adjustment_lines",
      ["business_id", "adjustment_id", "item_id", "quantity", "unit_cost"],
      req.body.lines.map((line) => ({ ...line, business_id: ctx.business.id, adjustment_id: adjustmentId })),
    );
    await postStockAdjustment(client, adjustmentId);
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "create",
      entityType: "stock_adjustment",
      entityId: adjustmentId,
      after: req.body,
    });
    return getAdjustment(client, ctx.business.id, adjustmentId);
  });
  created(res, adjustment);
});

router.post(
  "/:adjustmentId/cancel",
  requireRole("accountant"),
  idParams("adjustmentId"),
  validate(cancelSchema),
  async (req, res) => {
    const ctx = context(req);
    const adjustment = await withTransaction(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE stock_adjustments SET status = 'cancelled', cancelled_at = now()
         WHERE id = $1 AND business_id = $2 AND status = 'active'`,
        [req.params.adjustmentId, ctx.business.id],
      );
      if (!rowCount) throw new ApiError(404, "Active stock adjustment not found");

      await postStockAdjustment(client, req.params.adjustmentId);
      await audit(client, {
        businessId: ctx.business.id,
        userId: ctx.user.id,
        action: "cancel",
        entityType: "stock_adjustment",
        entityId: req.params.adjustmentId,
        after: { reason: req.body.reason },
      });
      return getAdjustment(client, ctx.business.id, req.params.adjustmentId);
    });
    ok(res, adjustment);
  },
);

export default router;
