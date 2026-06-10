require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { createClient } = require("redis");
const OpenAI = require("openai");
const app = express();
const pool = require("./db");

app.use(
  cors({
    origin: ["http://localhost:5174", "https://ai-chat-pied-six.vercel.app"],
    methods: ["GET", "POST", "PUT", "PATCH"],
    credentials: true,
  }),
);
app.use(express.json());

// const redisClient = createClient({
//   url: "redis://redis:6379",
// });

// redisClient.on("error", (err) => {
//   console.log("Redis Error:", err);
// });

// (async () => {
//   await redisClient.connect();
// })();

// app.get("/", async (req, res) => {
//   let visits = await redisClient.get("visits");

//   visits = visits ? parseInt(visits) + 1 : 1;

//   await redisClient.set("visits", visits);

//   res.send(`Visits: ${visits}`);
// });

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    const userMessage = message.toLowerCase();

    let data = "No data found.";

    if (userMessage.includes("report")) {
      const reportResult = await pool.query(`
        SELECT
          COUNT(*) AS total_products,
          AVG(price::numeric) AS avg_price,
          MIN(price::numeric) AS min_price,
          MAX(price::numeric) AS max_price
        FROM neon_auth.ecomaddproduct
      `);

      data = JSON.stringify(reportResult.rows, null, 2);
    } else if (
      userMessage.includes("pending order") ||
      userMessage.includes("pending orders")
    ) {
      const orderResult = await pool.query(`
        SELECT *
        FROM neon_auth.orders
        WHERE order_status = 'pending'
        LIMIT 20
      `);

      data = JSON.stringify(orderResult.rows, null, 2);
    } else if (
      userMessage.includes("rating") ||
      userMessage.includes("rated product")
    ) {
      const ratingResult = await pool.query(`
        SELECT
          p.product_id,
          p.productname,
          p.price,
          r.star_rated
        FROM neon_auth.ratings r
        JOIN neon_auth.ecomaddproduct p
          ON p.product_id = r.product_id
      `);

      data = JSON.stringify(ratingResult.rows, null, 2);
    } else if (
      userMessage.includes("product") ||
      userMessage.includes("products")
    ) {
      const productResult = await pool.query(`
        SELECT *
        FROM neon_auth.ecomaddproduct
        LIMIT 20
      `);

      data = JSON.stringify(productResult.rows, null, 2);
    }

    const response = await client.chat.completions.create({
      model: "openrouter/owl-alpha",
      messages: [
        {
          role: "system",
          content: `
            You are an assistant that answers using database results.

            Database Data:
            ${data}

            Rules:
            - Use only the provided data.
            - If no relevant data exists, say:
              "I couldn't find that information in the database."
          `,
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    res.json({
      reply: response.choices[0].message.content,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
