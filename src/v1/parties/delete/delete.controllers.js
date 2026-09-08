import pool from "../../../db/db.js";
import { ApiError } from "../../../utils/ApiError.js";

export async function deleteParty(req, res) {
  const { businessId, partyId } = req.params;

  // invoices.transporter_party_id is ON DELETE RESTRICT, so the database would
  // reject this anyway - checked here to return a message that explains why
  // rather than a bare foreign-key violation.
  const transporterRefs = await pool.query(
    "SELECT 1 FROM invoices WHERE transporter_party_id = $1 AND business_id = $2 LIMIT 1",
    [partyId, businessId]
  );

  if (transporterRefs.rowCount > 0) {
    throw new ApiError(
      400,
      "This party is the transporter on one or more bills. Remove them from those bills before deleting."
    );
  }

  const result = await pool.query(
    "DELETE FROM parties WHERE id = $1 AND business_id = $2 RETURNING id",
    [partyId, businessId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Party not found");
  }

  res.status(204).end();
}
