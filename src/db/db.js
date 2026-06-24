import pkg from "pg";
import logger from "../utils/logger.js";

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Helper to format query text for clean logging
const formatQueryText = (text) => {
  if (typeof text === "string") {
    return text.replace(/\s+/g, " ").trim();
  }
  if (text && typeof text.text === "string") {
    return text.text.replace(/\s+/g, " ").trim();
  }
  return "Complex query";
};

// Instrument pool.query
const originalPoolQuery = pool.query;
pool.query = async function (text, params) {
  const start = Date.now();
  try {
    const res = await originalPoolQuery.apply(this, arguments);
    const duration = Date.now() - start;
    const queryStr = formatQueryText(text).substring(0, 120);
    logger.debug(`[DB Query] ${duration}ms | ${queryStr}`);
    return res;
  } catch (err) {
    const duration = Date.now() - start;
    const queryStr = formatQueryText(text);
    logger.error(`[DB Query Error] ${duration}ms | Query: ${queryStr} | Error: ${err.message}`);
    throw err;
  }
};

// Helper to wrap client queries
const wrapClient = (client) => {
  if (!client.query.__wrapped) {
    const originalClientQuery = client.query;
    client.query = async function (text, params) {
      const start = Date.now();
      try {
        const res = await originalClientQuery.apply(this, arguments);
        const duration = Date.now() - start;
        const queryStr = formatQueryText(text).substring(0, 120);
        logger.debug(`[DB Tx Query] ${duration}ms | ${queryStr}`);
        return res;
      } catch (err) {
        const duration = Date.now() - start;
        const queryStr = formatQueryText(text);
        logger.error(`[DB Tx Query Error] ${duration}ms | Query: ${queryStr} | Error: ${err.message}`);
        throw err;
      }
    };
    client.query.__wrapped = true;
  }
};

// Instrument pool.connect to capture transaction queries
const originalPoolConnect = pool.connect;
pool.connect = function (callback) {
  if (typeof callback === "function") {
    return originalPoolConnect.call(this, (err, client, release) => {
      if (client) {
        wrapClient(client);
      }
      callback(err, client, release);
    });
  }
  
  return originalPoolConnect.apply(this, arguments).then((client) => {
    if (client) {
      wrapClient(client);
    }
    return client;
  });
};

export default pool;
