const { Pool } = require("pg");

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  schema: process.env.DB_SCHEMA,
   ssl: {
    rejectUnauthorized: false,
  },
});
pool.connect()
  .then(client => {
    console.log("Database connected");
    client.release();
  })
  .catch(err => {
    console.error("Database connection error:", err);
  });
module.exports = pool;
