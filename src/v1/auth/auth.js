import express from "express";
import { signup } from "./signup/signup.controllers.js";
import { login } from "./login/login.controllers.js";
import { refreshSession } from "./refresh/refresh.controllers.js";
import { logout } from "./logout/logout.controllers.js";
import { requireAuth } from "../../middlewares/auth.middlewares.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { signupSchema, loginSchema, refreshTokenSchema } from "../../utils/validators.js";

const router = express.Router();

router.post("/signup", validate(signupSchema), asyncHandler(signup));
router.post("/login", validate(loginSchema), asyncHandler(login));
router.post("/refresh", validate(refreshTokenSchema), asyncHandler(refreshSession));
router.post("/logout", asyncHandler(logout));

// Protected test endpoint to verify authorization headers
router.get("/me", requireAuth, (req, res) => {
  res.status(200).json({ user: req.user });
});

export default router;
