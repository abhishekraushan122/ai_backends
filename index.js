require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { createClient } = require("redis");
const OpenAI = require("openai");
const app = express();
const pool = require("./db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

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

const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: "Token required",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      id: decoded.id,
    };

    next();
  } catch (err) {
    return res.status(401).json({
      error: "Invalid token",
    });
  }
};

app.post("/chat", authMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({
        error: "Message is required",
      });
    }
    const userMessage = message.toLowerCase();
    
    await pool.query(
      `INSERT INTO neon_auth.chat_history (user_id, role, message)
   VALUES ($1, $2, $3)`,
      [req.user.id, "user", message],
    );
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
      userMessage.includes("pending") ||
      userMessage.includes("pending order")
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
      userMessage.includes("price")
    ) {
      const productResult = await pool.query(`
        SELECT *
        FROM neon_auth.ecomaddproduct where price <= 1000
        LIMIT 20
      `);

      data = JSON.stringify(productResult.rows, null, 2);
    }

    const historyResult = await pool.query(
      `SELECT role, message
   FROM neon_auth.chat_history
   WHERE user_id = $1
   ORDER BY created_at ASC`,
      [req.user.id],
    );

    const response = await client.chat.completions.create({
      model: "openrouter/owl-alpha",
      messages: [
        {
          role: "system",
          content: `
            You are an assistant that answers using database results.

            Database Data:
            ${data}

          `,
        },
        // {
        //   role: "user",
        //   content: message,
        // },
        ...historyResult.rows.map((row) => ({
          role: row.role,
          content: row.message,
        })),
      ],
    });

    const reply = response.choices[0].message.content;

    await pool.query(
      `INSERT INTO neon_auth.chat_history (user_id, role, message)
   VALUES ($1, $2, $3)`,
      [req.user.id, "assistant", reply],
    );

    res.json({
      success: true,
      reply: response.choices[0].message.content,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    console.log("name:", name);
    console.log("email:", email);
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    // Check existing user
    const existingUser = await pool.query(
      `SELECT id FROM neon_auth.users WHERE email = '${email}'`,
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    console.log("hashedPassword:", hashedPassword);

    const result = await pool.query(
      `INSERT INTO neon_auth.users (name, email, password)
   VALUES ($1, $2, $3)
   RETURNING *`,
      [name, email, hashedPassword],
    );
    res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: result.rows[0],
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // const result = await pool.query(`SELECT * FROM users WHERE email = ${email}`);
    const result = await pool.query(
      `SELECT * FROM neon_auth.users WHERE email = $1`,
      [email],
    );
    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const user = result.rows[0];

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d",
      },
    );

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
