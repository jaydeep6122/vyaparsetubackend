import express from "express";
import { createItem } from "./create/create.controllers.js";
import { listItems, getItemById } from "./read/read.controllers.js";
import { updateItem } from "./update/update.controllers.js";
import { deleteItem } from "./delete/delete.controllers.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { createItemSchema, updateItemSchema } from "../../utils/validators.js";

const router = express.Router({ mergeParams: true });

router.post("/", validate(createItemSchema), asyncHandler(createItem));
router.get("/", asyncHandler(listItems));
router.get("/:itemId", asyncHandler(getItemById));
router.put("/:itemId", validate(updateItemSchema), asyncHandler(updateItem));
router.delete("/:itemId", asyncHandler(deleteItem));

export default router;
