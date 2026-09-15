import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middlewares.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { created, ok } from "../../utils/http.js";
import * as schemas from "./auth.schemas.js";
import * as auth from "./auth.service.js";

const router = Router();

const withDevice = (req) => ({
  ...req.body,
  device_info: req.body.device_info ?? req.headers["user-agent"]?.slice(0, 255) ?? null,
});

router.post("/signup", validate(schemas.signupSchema), async (req, res) => {
  created(res, await auth.signup(withDevice(req)));
});

router.post("/login", validate(schemas.loginSchema), async (req, res) => {
  ok(res, await auth.login(withDevice(req)));
});

router.post("/refresh", validate(schemas.refreshSchema), async (req, res) => {
  ok(res, await auth.refresh(req.body));
});

router.post("/logout", validate(schemas.logoutSchema), async (req, res) => {
  await auth.logout(req.body);
  ok(res, { logged_out: true });
});

router.post("/password/forgot", validate(schemas.forgotPasswordSchema), async (req, res) => {
  await auth.requestPasswordReset(req.body, { ip: req.ip });
  ok(res, { message: "If an account exists for this email, a reset code has been sent" });
});

router.post("/password/reset", validate(schemas.resetPasswordSchema), async (req, res) => {
  ok(res, await auth.resetPassword(withDevice(req)));
});

router.get("/me", requireAuth, async (req, res) => {
  ok(res, await auth.getMe(req.user.id));
});

router.patch("/me", requireAuth, validate(schemas.updateMeSchema), async (req, res) => {
  ok(res, await auth.updateMe(req.user.id, req.body));
});

router.post("/me/password", requireAuth, validate(schemas.changePasswordSchema), async (req, res) => {
  ok(res, await auth.changePassword(req.user.id, withDevice(req)));
});

export default router;
