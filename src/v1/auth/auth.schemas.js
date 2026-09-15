import { z } from "zod";
import { email, optionalText, phone, text } from "../../utils/schemas.js";

const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

const deviceInfo = optionalText(255);
const refreshToken = z.string().min(1, "refresh_token is required").max(200);

export const signupSchema = z.object({
  name: text(255),
  email,
  phone: phone.nullable().optional(),
  password,
  device_info: deviceInfo,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required").max(128),
  device_info: deviceInfo,
});

export const refreshSchema = z.object({
  refresh_token: refreshToken,
  device_info: deviceInfo,
});

export const logoutSchema = z.object({
  refresh_token: refreshToken,
  all_devices: z.boolean().optional(),
});

export const updateMeSchema = z.object({
  name: text(255).optional(),
  phone: phone.nullable().optional(),
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, "current_password is required").max(128),
  new_password: password,
  device_info: deviceInfo,
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  email,
  code: z.string().trim().regex(/^\d{6}$/, "The code has 6 digits"),
  new_password: password,
  device_info: deviceInfo,
});
