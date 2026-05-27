module.exports = {
  apps: [
    {
      name: "rayon-v2-api",

      script: "backend/server.js",

      instances: 1,

      exec_mode: "fork",

      watch: false,

      env: {
        NODE_ENV: "production",
      },

      error_file: "./logs/api-error.log",

      out_file: "./logs/api-out.log",

      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};