import { createUserService } from "../services/signup.services.js";
import { ApiError } from "../utils/ApiError.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";

export async function signup(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }

  const hashedPassword = crypto
    .createHash("sha256")
    .update(password)
    .digest("hex");

  const user = await createUserService(email, hashedPassword);

  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
    expiresIn: "2h",
  });

  res.status(201).json({ user, token });
  // res.json(user);
}
