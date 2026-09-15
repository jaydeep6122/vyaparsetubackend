import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middlewares.js";
import { validate } from "../../middlewares/validation.middlewares.js";
import { ok } from "../../utils/http.js";
import { acceptInviteSchema } from "../businesses/businesses.schemas.js";
import { acceptInvite } from "../businesses/businesses.service.js";

const router = Router();

router.post("/accept", requireAuth, validate(acceptInviteSchema), async (req, res) => {
  ok(res, await acceptInvite(req.user, req.body.token));
});

export default router;
