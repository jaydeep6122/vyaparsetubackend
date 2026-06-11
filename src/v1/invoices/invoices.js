import express from "express";
import { createInvoice } from "./create/create.controllers.js";
import { listInvoices, getInvoiceById } from "./read/read.controllers.js";
import { updateInvoice } from "./update/update.controllers.js";
import { deleteInvoice } from "./delete/delete.controllers.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

const router = express.Router({ mergeParams: true });

router.post("/", asyncHandler(createInvoice));
router.get("/", asyncHandler(listInvoices));
router.get("/:invoiceId", asyncHandler(getInvoiceById));
router.put("/:invoiceId", asyncHandler(updateInvoice));
router.delete("/:invoiceId", asyncHandler(deleteInvoice));

export default router;
