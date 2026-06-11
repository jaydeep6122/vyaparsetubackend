import express from "express";
import { createParty } from "./create/create.controllers.js";
import { listParties, getPartyById } from "./read/read.controllers.js";
import { updateParty } from "./update/update.controllers.js";
import { deleteParty } from "./delete/delete.controllers.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

const router = express.Router({ mergeParams: true });

router.post("/", asyncHandler(createParty));
router.get("/", asyncHandler(listParties));
router.get("/:partyId", asyncHandler(getPartyById));
router.put("/:partyId", asyncHandler(updateParty));
router.delete("/:partyId", asyncHandler(deleteParty));

export default router;
