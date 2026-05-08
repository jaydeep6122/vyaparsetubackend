import express from "express";
import { signup } from "../controllers/signup.controllers.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = express.Router();

router.post("/", asyncHandler(signup));

export default router;
