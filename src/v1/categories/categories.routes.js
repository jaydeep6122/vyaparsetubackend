import { Router } from "express";
import { z } from "zod";
import pool from "../../db/db.js";
import { requireRole } from "../../middlewares/auth.middlewares.js";
import { idParams } from "../../middlewares/params.middlewares.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { ApiError } from "../../utils/ApiError.js";
import { created, ok } from "../../utils/http.js";
import { queryBoolean, text } from "../../utils/schemas.js";

const COLUMNS = "id, name, archived_at, created_at";
const nameSchema = z.object({ name: text(100) });
const listSchema = z.object({ include_archived: queryBoolean.optional() });

/** Item and expense categories share the same shape and rules. */
function categoriesRouter(table, label) {
  const router = Router({ mergeParams: true });

  router.get("/", validate(listSchema, "query"), async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${COLUMNS} FROM ${table}
       WHERE business_id = $1 ${req.query.include_archived ? "" : "AND archived_at IS NULL"}
       ORDER BY lower(name)`,
      [req.business.id],
    );
    ok(res, rows);
  });

  router.post("/", validate(nameSchema), async (req, res) => {
    const {
      rows: [category],
    } = await pool.query(
      `INSERT INTO ${table} (business_id, name) VALUES ($1, $2) RETURNING ${COLUMNS}`,
      [req.business.id, req.body.name],
    );
    created(res, category);
  });

  router.patch("/:categoryId", idParams("categoryId"), validate(nameSchema), async (req, res) => {
    const {
      rows: [category],
    } = await pool.query(
      `UPDATE ${table} SET name = $1 WHERE id = $2 AND business_id = $3 RETURNING ${COLUMNS}`,
      [req.body.name, req.params.categoryId, req.business.id],
    );
    if (!category) throw new ApiError(404, `${label} not found`);
    ok(res, category);
  });

  for (const [action, value] of [["archive", "now()"], ["restore", "NULL"]]) {
    router.post(`/:categoryId/${action}`, requireRole("accountant"), idParams("categoryId"), async (req, res) => {
      const {
        rows: [category],
      } = await pool.query(
        `UPDATE ${table} SET archived_at = ${value} WHERE id = $1 AND business_id = $2 RETURNING ${COLUMNS}`,
        [req.params.categoryId, req.business.id],
      );
      if (!category) throw new ApiError(404, `${label} not found`);
      ok(res, category);
    });
  }

  return router;
}

export const itemCategoriesRouter = categoriesRouter("item_categories", "Item category");
export const expenseCategoriesRouter = categoriesRouter("expense_categories", "Expense category");
