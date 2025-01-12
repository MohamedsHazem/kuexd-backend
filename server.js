require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN.split(",");

// Middleware for logging HTTP requests
app.use(morgan("combined"));

// CORS Configuration
app.use(
  cors({
    origin: CORS_ORIGIN,
    methods: ["GET", "POST"],
  })
);

// API Key Validation Middleware
app.use((req, res, next) => {
  // Skip API key validation for health check endpoint
  if (req.path === "/health") {
    return next();
  }

  const apiKey = req.headers["x-api-key"];
  if (apiKey !== process.env.API_KEY) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  next();
});

// Serve Static Files
app.use(express.static(path.join(__dirname, "public")));

/* -------------------------------------------------------------------------- */
/*                               Server Health Check                          */
/* -------------------------------------------------------------------------- */

/**
 * Base URL to check if the server is running.
 * Displays a simple HTML page with server status information.
 */
app.get("/", (req, res) => {
  res.status(200).send(`
    <html>
      <head>
        <title>API Status</title>
      </head>
      <body>
        <h1 style="color: green;">✅ Server is Running!</h1>
        <p>Everything is working as expected.</p>
        <p><strong>Version:</strong> 1.0.0</p>
        <p><strong>Environment:</strong> ${
          process.env.NODE_ENV || "development"
        }</p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
      </body>
    </html>
  `);
});

/**
 * Health check endpoint for automated monitoring.
 * Returns JSON with server health details.
 */
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "Healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

/* -------------------------------------------------------------------------- */
/*                               WebSocket Setup                              */
/* -------------------------------------------------------------------------- */

const io = new Server(server, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000, // Extend ping timeout for long connections
});

let userList = [];

io.on("connection", (socket) => {
  console.log("🟢 A user connected:", socket.id);

  socket.on("user name", (userName) => {
    socket.userName = userName;
    userList[socket.id] = { id: socket.id, userName };
    console.log(
      `🔵 User ${userName} connected/updated with socket ID: ${socket.id}`
    );
    io.emit("users", Object.values(userList));
  });

  socket.on("chat message", (msg) => {
    console.log("✉️ Message received:", msg);
    socket.broadcast.emit("chat message", msg);
  });

  socket.on("disconnect", () => {
    console.log(
      `🔴 User ${socket.userName || "Unknown"} disconnected with socket ID: ${
        socket.id
      }`
    );
    delete userList[socket.id];
    io.emit("users", Object.values(userList));
  });
});

/* -------------------------------------------------------------------------- */
/*                               Global Error Handling                        */
/* -------------------------------------------------------------------------- */

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

/* -------------------------------------------------------------------------- */
/*                               Start the Server                             */
/* -------------------------------------------------------------------------- */

server.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
