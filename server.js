// server.js
require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const PORT = process.env.PORT || 3000;
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    credentials: false,
  },
  pingTimeout: 60000,
});

// Middleware
app.use(
  cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], credentials: false })
);

// Routes
const routes = require("./routes");
app.use("/", routes);

// Sockets
const initializeSockets = require("./sockets");
initializeSockets(io);

// Start the server
httpServer.listen(PORT, () => {
  console.log(`✅ HTTP Server is running on port ${PORT}`);
});
