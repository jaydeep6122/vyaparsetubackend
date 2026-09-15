const toJson = (value) => (value == null ? null : JSON.stringify(value));

/** Appends one audit_log row inside the caller's transaction. */
export async function audit(
  client,
  { businessId = null, userId = null, action, entityType, entityId = null, before = null, after = null },
) {
  await client.query(
    `INSERT INTO audit_log (business_id, user_id, action, entity_type, entity_id, before, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [businessId, userId, action, entityType, entityId, toJson(before), toJson(after)],
  );
}
