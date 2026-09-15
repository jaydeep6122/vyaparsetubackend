import { z } from "zod";
import {
  date,
  hsnSac,
  id,
  listQuery,
  optionalText,
  quantity,
  queryBoolean,
  text,
  unitCode,
  unitRate,
} from "../../utils/schemas.js";

const itemType = z.enum(["goods", "service"]);

const itemFields = {
  name: text(255),
  item_type: itemType,
  category_id: id.nullable().optional(),
  sku: optionalText(50),
  barcode: optionalText(50),
  hsn_sac: hsnSac.nullable().optional(),
  unit_code: unitCode,
  sale_price: unitRate().nullable().optional(),
  purchase_price: unitRate().nullable().optional(),
  price_includes_tax: z.boolean(),
  tax_rate_id: id.nullable().optional(),
  track_stock: z.boolean(),
  low_stock_threshold: quantity({ min: 0 }).nullable().optional(),
  opening_stock: quantity({ min: 0 }).optional(),
  opening_stock_rate: unitRate().nullable().optional(),
  opening_stock_date: date.optional(),
};

export const createItemSchema = z.object({
  ...itemFields,
  item_type: itemType.optional(),
  unit_code: unitCode.optional(),
  price_includes_tax: z.boolean().optional(),
  track_stock: z.boolean().optional(),
});

export const updateItemSchema = z.object(itemFields).partial();

export const listItemsQuery = listQuery({
  search: z.string().trim().max(100).optional(),
  category_id: id.optional(),
  low_stock: queryBoolean.optional(),
  include_archived: queryBoolean.optional(),
});
