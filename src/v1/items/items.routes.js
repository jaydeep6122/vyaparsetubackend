import { Router } from "express";
import pool from "../../db/db.js";
import { requireRole } from "../../middlewares/auth.middlewares.js";
import { idParams } from "../../middlewares/params.middlewares.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { context, created, ok, paged } from "../../utils/http.js";
import * as schemas from "./items.schemas.js";
import * as service from "./items.service.js";

const router = Router({ mergeParams: true });

router.get("/", validate(schemas.listItemsQuery, "query"), async (req, res) => {
  paged(res, await service.listItems(context(req), req.query));
});

router.post("/", validate(schemas.createItemSchema), async (req, res) => {
  created(res, await service.createItem(context(req), req.body));
});

router.get("/:itemId", idParams("itemId"), async (req, res) => {
  ok(res, await service.getItem(pool, req.business.id, req.params.itemId));
});

router.patch("/:itemId", idParams("itemId"), validate(schemas.updateItemSchema), async (req, res) => {
  ok(res, await service.updateItem(context(req), req.params.itemId, req.body));
});

router.post("/:itemId/archive", requireRole("accountant"), idParams("itemId"), async (req, res) => {
  ok(res, await service.setItemArchived(context(req), req.params.itemId, true));
});

router.post("/:itemId/restore", requireRole("accountant"), idParams("itemId"), async (req, res) => {
  ok(res, await service.setItemArchived(context(req), req.params.itemId, false));
});

export default router;
