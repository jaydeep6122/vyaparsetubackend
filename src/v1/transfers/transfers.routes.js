import { Router } from "express";
import { z } from "zod";
import pool from "../../db/db.js";
import { Filters, insertRows, pageResult } from "../../db/sql.js";
import { withTransaction } from "../../db/transaction.js";
import { requireRole } from "../../middlewares/auth.middlewares.js";
import { idParams } from "../../middlewares/params.middlewares.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { audit } from "../../services/audit.js";
import { postTransfer } from "../../services/posting.js";
import { ApiError } from "../../utils/ApiError.js";
import { today } from "../../utils/fy.js";
import { context, created, ok, paged } from "../../utils/http.js";
import { date, id, listQuery, money, optionalText } from "../../utils/schemas.js";
import { cancelSchema } from "../payments/payments.schemas.js";

const transferSchema = z
  .object({
    transfer_date: date.optional(),
    from_account_id: id,
    to_account_id: id,
    amount: money({ gt: 0 }),
    notes: optionalText(500),
  })
  .refine((transfer) => transfer.from_account_id !== transfer.to_account_id, {
    message: "Choose two different accounts",
    path: ["to_account_id"],
  });

const listTransfersQuery = listQuery({
  account_id: id.optional(),
  status: z.enum(["active", "cancelled"]).optional(),
  from: date.optional(),
  to: date.optional(),
});

const TRANSFER_SELECT = `
  SELECT t.*, fa.name AS from_account_name, ta.name AS to_account_name
  FROM account_transfers t
  JOIN accounts fa ON fa.id = t.from_account_id
  JOIN accounts ta ON ta.id = t.to_account_id`;

async function getTransfer(db, businessId, transferId) {
  const {
    rows: [transfer],
  } = await db.query(`${TRANSFER_SELECT} WHERE t.business_id = $1 AND t.id = $2`, [businessId, transferId]);
  if (!transfer) throw new ApiError(404, "Transfer not found");
  return transfer;
}

const router = Router({ mergeParams: true });
router.use(requireRole("accountant"));

router.get("/", validate(listTransfersQuery, "query"), async (req, res) => {
  const query = req.query;
  const filters = new Filters().add("t.business_id = ?", req.business.id);
  filters.addIf(query.account_id, "(t.from_account_id = ? OR t.to_account_id = ?)", query.account_id);
  filters.addIf(query.status, "t.status = ?", query.status);
  filters.addIf(query.from, "t.transfer_date >= ?", query.from);
  filters.addIf(query.to, "t.transfer_date <= ?", query.to);

  const { rows } = await pool.query(
    `SELECT listed.*, COUNT(*) OVER () AS total_count
     FROM (${TRANSFER_SELECT} ${filters.where}) listed
     ORDER BY listed.transfer_date DESC, listed.created_at DESC
     LIMIT ${filters.param(query.limit)} OFFSET ${filters.param(query.offset)}`,
    filters.values,
  );
  paged(res, pageResult(rows, query));
});

router.post("/", validate(transferSchema), async (req, res) => {
  const ctx = context(req);
  const transfer = await withTransaction(async (client) => {
    const { rowCount } = await client.query(
      "SELECT 1 FROM accounts WHERE business_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL",
      [ctx.business.id, [req.body.from_account_id, req.body.to_account_id]],
    );
    if (rowCount !== 2) throw new ApiError(400, "Both accounts must exist and not be archived");

    const [{ id: transferId }] = await insertRows(
      client,
      "account_transfers",
      ["business_id", "transfer_date", "from_account_id", "to_account_id", "amount", "notes", "created_by"],
      [
        {
          ...req.body,
          business_id: ctx.business.id,
          transfer_date: req.body.transfer_date ?? today(),
          created_by: ctx.user.id,
        },
      ],
      "id",
    );
    await postTransfer(client, transferId);
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "create",
      entityType: "account_transfer",
      entityId: transferId,
      after: req.body,
    });
    return getTransfer(client, ctx.business.id, transferId);
  });
  created(res, transfer);
});

router.post("/:transferId/cancel", idParams("transferId"), validate(cancelSchema), async (req, res) => {
  const ctx = context(req);
  const transfer = await withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE account_transfers SET status = 'cancelled', cancelled_at = now()
       WHERE id = $1 AND business_id = $2 AND status = 'active'`,
      [req.params.transferId, ctx.business.id],
    );
    if (!rowCount) throw new ApiError(404, "Active transfer not found");

    await postTransfer(client, req.params.transferId);
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "cancel",
      entityType: "account_transfer",
      entityId: req.params.transferId,
      after: { reason: req.body.reason },
    });
    return getTransfer(client, ctx.business.id, req.params.transferId);
  });
  ok(res, transfer);
});

export default router;
