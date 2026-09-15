import { Router } from "express";
import { z } from "zod";
import pool from "../../db/db.js";
import { setClause } from "../../db/sql.js";
import { requireRole } from "../../middlewares/auth.middlewares.js";
import { idParams } from "../../middlewares/params.middlewares.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { ApiError } from "../../utils/ApiError.js";
import { created, ok } from "../../utils/http.js";
import { dec } from "../../utils/money.js";
import { percent, text } from "../../utils/schemas.js";

const COLUMNS = "id, name, rate, cess_rate, is_active";

const createTaxRateSchema = z.object({
  name: text(50).optional(),
  rate: percent(),
  cess_rate: percent().optional(),
});

// A rate itself never changes once created: invoices copy it, and a changed
// slab is a new rate. Old ones are deactivated instead.
const updateTaxRateSchema = z.object({
  name: text(50).optional(),
  is_active: z.boolean().optional(),
});

const router = Router({ mergeParams: true });

router.get("/", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM tax_rates WHERE business_id = $1 ORDER BY rate, cess_rate`,
    [req.business.id],
  );
  ok(res, rows);
});

router.post("/", requireRole("admin"), validate(createTaxRateSchema), async (req, res) => {
  const { rate, cess_rate = "0" } = req.body;
  const defaultName = `GST ${dec(rate)}%${dec(cess_rate).gt(0) ? ` + ${dec(cess_rate)}% cess` : ""}`;
  const {
    rows: [taxRate],
  } = await pool.query(
    `INSERT INTO tax_rates (business_id, name, rate, cess_rate) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
    [req.business.id, req.body.name ?? defaultName, rate, cess_rate],
  );
  created(res, taxRate);
});

router.patch(
  "/:taxRateId",
  requireRole("admin"),
  idParams("taxRateId"),
  validate(updateTaxRateSchema),
  async (req, res) => {
    const set = setClause(req.body, ["name", "is_active"]);
    if (set.keys.length === 0) throw new ApiError(400, "Nothing to update");

    const {
      rows: [taxRate],
    } = await pool.query(
      `UPDATE tax_rates SET ${set.sql}
       WHERE id = $${set.keys.length + 1} AND business_id = $${set.keys.length + 2}
       RETURNING ${COLUMNS}`,
      [...set.values, req.params.taxRateId, req.business.id],
    );
    if (!taxRate) throw new ApiError(404, "Tax rate not found");
    ok(res, taxRate);
  },
);

export default router;
