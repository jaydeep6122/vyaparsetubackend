import express from "express";
import { signup } from "./signup/signup.controllers.js";
import { login } from "./login/login.controllers.js";
import { refreshSession } from "./refresh/refresh.controllers.js";
import { logout } from "./logout/logout.controllers.js";
import { requireAuth } from "../../middlewares/auth.middlewares.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

const router = express.Router();

router.post("/signup", asyncHandler(signup));
router.post("/login", asyncHandler(login));
router.post("/refresh", asyncHandler(refreshSession));
router.post("/logout", asyncHandler(logout));

// Protected test endpoint to verify authorization headers
router.get("/me", requireAuth, (req, res) => {
  res.status(200).json({ user: req.user });
});

export default router;
