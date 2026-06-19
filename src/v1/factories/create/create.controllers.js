import { createFactoryService } from "./create.services.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function createFactory(req, res) {
  const { name, location } = req.body;
  const userId = req.user.id;

  if (!name) {
    throw new ApiError(400, "Name is required");
  }

  const factory = await createFactoryService(userId, { name, location });
  res.status(201).json(factory);
}
