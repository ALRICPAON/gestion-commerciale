require("dotenv").config();

module.exports = {
  port: process.env.PORT || 3002,

  databaseUrl: process.env.DATABASE_URL,

  jwtSecret: process.env.JWT_SECRET,

  nodeEnv: process.env.NODE_ENV || "development",

  frontendUrl: process.env.FRONTEND_URL,

  apiBaseUrl: process.env.API_BASE_URL,

  uploadDir: process.env.UPLOAD_DIR || "uploads",
};
