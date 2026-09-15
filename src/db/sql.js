/**
 * Small helpers for building parameterised SQL. Table and column names passed
 * here always come from code, never from request input.
 */

/** Multi-row INSERT; undefined values are written as NULL. */
export async function insertRows(client, table, columns, rows, returning) {
  if (rows.length === 0) return [];

  const values = [];
  const tuples = rows.map(
    (row) =>
      `(${columns
        .map((column) => {
          values.push(row[column] === undefined ? null : row[column]);
          return `$${values.length}`;
        })
        .join(", ")})`,
  );

  const { rows: inserted } = await client.query(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}` +
      (returning ? ` RETURNING ${returning}` : ""),
    values,
  );
  return inserted;
}

/**
 * `col = $n` pairs for the columns present in `data` (undefined = leave
 * unchanged, null = clear). Parameters start at `firstIndex`.
 */
export function setClause(data, columns, firstIndex = 1) {
  const keys = columns.filter((column) => data[column] !== undefined);
  return {
    keys,
    sql: keys.map((key, i) => `${key} = $${firstIndex + i}`).join(", "),
    values: keys.map((key) => data[key]),
  };
}

/** Collects WHERE clauses; every `?` in a clause becomes that clause's parameter. */
export class Filters {
  constructor() {
    this.clauses = [];
    this.values = [];
  }

  param(value) {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  add(clause, value) {
    this.clauses.push(
      value === undefined ? clause : clause.replaceAll("?", this.param(value)),
    );
    return this;
  }

  addIf(condition, clause, value) {
    return condition ? this.add(clause, value) : this;
  }

  get where() {
    return this.clauses.length ? `WHERE ${this.clauses.join(" AND ")}` : "";
  }
}

/** Escapes LIKE wildcards so user search text matches literally. */
export const likePattern = (text) =>
  `%${String(text).replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/**
 * List queries select `COUNT(*) OVER () AS total_count`; this strips it and
 * builds the pagination block.
 */
export function pageResult(rows, { limit, offset }) {
  const total =
    rows.length > 0 ? rows[0].total_count : offset === 0 ? 0 : null;
  return {
    rows: rows.map(({ total_count, ...row }) => row),
    pagination: { limit, offset, total },
  };
}
