require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { createClient } = require("redis");
const OpenAI = require("openai");
const app = express();
const pool = require("./db");

app.use(cors({
  origin: "https://ai-chat-pied-six.vercel.app",
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));
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
    // const models = await client.models.list();

    // console.log(models.data.map((m) => m.id),"test");
    const result = await pool.query(`
      SELECT *
      FROM neon_auth.ecomaddproduct
      WHERE price::numeric <= 500
      LIMIT 5
    `);

    // Pending Orders
    const orderResult = await pool.query(`
      SELECT *
      FROM neon_auth.orders
      WHERE order_status = 'pending'
      LIMIT 20
    `);

// const product_rating = await pool.query(`
//   SELECT
//     p.product_id,
//     p.productname,
//     p.price,
//     r.star_rated
//   FROM abhishek.ratings r
//   JOIN abhishek.ecomaddproduct p
//     ON p.product_id = r.product_id
//   WHERE r.star_rated::numeric = 4
// `);
    const dbData =
      result.rows.length > 0
        ? JSON.stringify(result.rows, null, 2)
        : "No matching records found.";

    const orderData =
      orderResult.rows.length > 0
        ? JSON.stringify(orderResult.rows, null, 4)
        : "No pending orders found.";

    // const productRatedData =
    //   product_rating.rows.length > 0
    //     ? JSON.stringify(product_rating.rows, null, 3)
    //     : "No matching records found.";
    
    const response = await client.chat.completions.create({
      model: "openrouter/owl-alpha",
      messages: [
        {
          role: "system",
          content: `
          You are an assistant that answers using PostgreSQL data.

          Database Results:
          ${dbData}

          Pending Orders:
          ${orderData}
          

          Rules:
          - Use only the provided database data.
          - If the user asks about products, answer from Products.
          - If the user asks about pending orders, answer from Pending Orders.
          - If information is unavailable, reply:
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
