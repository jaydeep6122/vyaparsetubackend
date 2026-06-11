import winston from "winston";
import path from "path";

const { combine, timestamp, json, errors, printf, colorize } = winston.format;

// Custom format for development (human readable)
const devFormat = printf(({ level, message, timestamp, stack, ...metadata }) => {
  let msg = `${timestamp} [${level}] : ${message}`;
  if (Object.keys(metadata).length > 0) {
    msg += ` | ${JSON.stringify(metadata)}`;
  }
  if (stack) {
    msg += `\n${stack}`;
  }
  return msg;
});

// Determine log level from environment
const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug");

// Create logger instance
const logger = winston.createLogger({
  level,
  defaultMeta: { service: "vyaparsetu-backend" },
  transports: [
    // Write all logs to console
    new winston.transports.Console({
      format:
        process.env.NODE_ENV === "production"
          ? combine(timestamp(), json())
          : combine(colorize(), timestamp(), devFormat),
    }),
    // Write all errors to error log file
    new winston.transports.File({
      filename: path.join(process.cwd(), "logs", "error.log"),
      level: "error",
      format: combine(timestamp(), json()),
    }),
    // Write all logs to combined log file
    new winston.transports.File({
      filename: path.join(process.cwd(), "logs", "combined.log"),
      format: combine(timestamp(), json()),
    }),
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: path.join(process.cwd(), "logs", "exceptions.log") }),
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: path.join(process.cwd(), "logs", "rejections.log") }),
  ],
});

// Create logs directory if it doesn't exist
import fs from "fs";
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

export default logger;
