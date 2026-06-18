import express from "express";
import { createParty } from "./create/create.controllers.js";
import { listParties, getPartyById, getPartyQuantitySummary } from "./read/read.controllers.js";
import { updateParty } from "./update/update.controllers.js";
import { deleteParty } from "./delete/delete.controllers.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { createPartySchema, updatePartySchema } from "../../utils/validators.js";

const router = express.Router({ mergeParams: true });

router.post("/", validate(createPartySchema), asyncHandler(createParty));
router.get("/", asyncHandler(listParties));
router.get("/:partyId", asyncHandler(getPartyById));
router.get("/:partyId/quantity-summary", asyncHandler(getPartyQuantitySummary));
router.put("/:partyId", validate(updatePartySchema), asyncHandler(updateParty));
router.delete("/:partyId", asyncHandler(deleteParty));

export default router;

