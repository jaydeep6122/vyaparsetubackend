import express from "express";
import { createItem } from "./create/create.controllers.js";
import { listItems, getItemById } from "./read/read.controllers.js";
import { updateItem } from "./update/update.controllers.js";
import { deleteItem } from "./delete/delete.controllers.js";
import { adjustStock } from "./adjustStock/adjustStock.controllers.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

const router = express.Router({ mergeParams: true });

router.post("/", asyncHandler(createItem));
router.get("/", asyncHandler(listItems));
router.get("/:itemId", asyncHandler(getItemById));
router.put("/:itemId", asyncHandler(updateItem));
router.delete("/:itemId", asyncHandler(deleteItem));
router.post("/:itemId/adjust-stock", asyncHandler(adjustStock));

export default router;
