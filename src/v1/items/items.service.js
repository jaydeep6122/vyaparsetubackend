import pool from "../../db/db.js";
import { Filters, insertRows, likePattern, pageResult, setClause } from "../../db/sql.js";
import { withTransaction } from "../../db/transaction.js";
import { hasRole } from "../../middlewares/auth.middlewares.js";
import { audit } from "../../services/audit.js";
import { postItemOpening } from "../../services/posting.js";
import { ApiError } from "../../utils/ApiError.js";
import { today } from "../../utils/fy.js";
import { dec } from "../../utils/money.js";

const ITEM_COLUMNS = [
  "name",
  "item_type",
  "category_id",
  "sku",
  "barcode",
  "hsn_sac",
  "unit_code",
  "sale_price",
  "purchase_price",
  "price_includes_tax",
  "tax_rate_id",
  "track_stock",
  "low_stock_threshold",
];

const ITEM_SELECT = `
  SELECT i.*,
         t.rate AS tax_rate,
         t.cess_rate,
         c.name AS category_name,
         CASE WHEN i.track_stock THEN stock.quantity END AS quantity_on_hand,
         op.quantity AS opening_stock,
         op.unit_cost AS opening_stock_rate,
         op.movement_date AS opening_stock_date
  FROM items i
  LEFT JOIN tax_rates t ON t.id = i.tax_rate_id
  LEFT JOIN item_categories c ON c.id = i.category_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(SUM(m.quantity), 0)::numeric(15,3) AS quantity
    FROM stock_movements m
    WHERE m.business_id = i.business_id AND m.item_id = i.id
  ) stock
  LEFT JOIN stock_movements op
    ON op.item_id = i.id AND op.source_type = 'opening' AND op.source_id = i.id`;

const touchesOpening = (data) =>
  data.opening_stock !== undefined ||
  data.opening_stock_rate !== undefined ||
  data.opening_stock_date !== undefined;

function assertCanSetOpening(ctx, data) {
  if (touchesOpening(data) && !hasRole(ctx.role, "accountant")) {
    throw new ApiError(403, "Changing opening stock needs the accountant role or higher");
  }
}

export async function getItem(db, businessId, itemId) {
  const {
    rows: [item],
  } = await db.query(`${ITEM_SELECT} WHERE i.business_id = $1 AND i.id = $2`, [businessId, itemId]);
  if (!item) throw new ApiError(404, "Item not found");
  return item;
}

export async function listItems(ctx, query) {
  const filters = new Filters().add("i.business_id = ?", ctx.business.id);
  filters.addIf(!query.include_archived, "i.archived_at IS NULL");
  filters.addIf(query.category_id, "i.category_id = ?", query.category_id);
  filters.addIf(
    query.search,
    "(i.name ILIKE ? OR i.sku ILIKE ? OR i.barcode ILIKE ?)",
    query.search && likePattern(query.search),
  );
  filters.addIf(
    query.low_stock,
    "i.track_stock AND i.low_stock_threshold IS NOT NULL AND stock.quantity <= i.low_stock_threshold",
  );

  const { rows } = await pool.query(
    `SELECT listed.*, COUNT(*) OVER () AS total_count
     FROM (${ITEM_SELECT} ${filters.where}) listed
     ORDER BY lower(listed.name)
     LIMIT ${filters.param(query.limit)} OFFSET ${filters.param(query.offset)}`,
    filters.values,
  );
  return pageResult(rows, query);
}

export async function createItem(ctx, data) {
  assertCanSetOpening(ctx, data);
  const isService = data.item_type === "service";
  const trackStock = isService ? false : (data.track_stock ?? true);
  if (!trackStock && data.opening_stock && dec(data.opening_stock).gt(0)) {
    throw new ApiError(400, "Opening stock needs stock tracking to be on");
  }

  return withTransaction(async (client) => {
    const [item] = await insertRows(
      client,
      "items",
      ["business_id", ...ITEM_COLUMNS],
      [
        {
          ...data,
          business_id: ctx.business.id,
          item_type: data.item_type ?? "goods",
          unit_code: data.unit_code ?? "NOS",
          price_includes_tax: data.price_includes_tax ?? false,
          track_stock: trackStock,
        },
      ],
      "*",
    );

    if (trackStock) {
      await postItemOpening(client, item, {
        quantity: data.opening_stock,
        unitCost: data.opening_stock_rate ?? data.purchase_price ?? null,
        date: data.opening_stock_date ?? today(),
      });
    }
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "create",
      entityType: "item",
      entityId: item.id,
      after: item,
    });
    return getItem(client, ctx.business.id, item.id);
  });
}

export async function updateItem(ctx, itemId, data) {
  assertCanSetOpening(ctx, data);

  return withTransaction(async (client) => {
    const before = await getItem(client, ctx.business.id, itemId);
    const fields = { ...data };
    if ((data.item_type ?? before.item_type) === "service") fields.track_stock = false;

    const set = setClause(fields, ITEM_COLUMNS);
    if (set.keys.length > 0) {
      await client.query(
        `UPDATE items SET ${set.sql} WHERE id = $${set.keys.length + 1} AND business_id = $${set.keys.length + 2}`,
        [...set.values, itemId, ctx.business.id],
      );
    }

    if (touchesOpening(data)) {
      if (!(fields.track_stock ?? before.track_stock)) {
        throw new ApiError(400, "Opening stock needs stock tracking to be on");
      }
      await postItemOpening(
        client,
        { id: itemId, business_id: ctx.business.id },
        {
          quantity: data.opening_stock ?? before.opening_stock ?? 0,
          unitCost: data.opening_stock_rate !== undefined ? data.opening_stock_rate : before.opening_stock_rate,
          date: data.opening_stock_date ?? before.opening_stock_date ?? today(),
        },
      );
    }

    const after = await getItem(client, ctx.business.id, itemId);
    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "update",
      entityType: "item",
      entityId: itemId,
      before,
      after,
    });
    return after;
  });
}

export async function setItemArchived(ctx, itemId, archived) {
  return withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE items SET archived_at = ${archived ? "now()" : "NULL"} WHERE id = $1 AND business_id = $2`,
      [itemId, ctx.business.id],
    );
    if (!rowCount) throw new ApiError(404, "Item not found");

    await audit(client, {
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: archived ? "archive" : "restore",
      entityType: "item",
      entityId: itemId,
    });
    return getItem(client, ctx.business.id, itemId);
  });
}
