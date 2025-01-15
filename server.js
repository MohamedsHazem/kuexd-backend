/***************************************************************
 *  Required Dependencies & Basic Setup
 ***************************************************************/
require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

// Set up the port from .env or default to 3000
const PORT = process.env.PORT || 3000;

// Create an Express application
const app = express();

// Apply CORS configuration (allow from anywhere)
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    credentials: false,
  })
);

// Serve static files from the "public" folder
app.use(express.static(path.join(__dirname, "public")));

/***************************************************************
 *  Default route for quick server-health checks
 ***************************************************************/
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>API Status</title>
      </head>
      <body>
        <h1 style="color: green;">✅ Server is Running!</h1>
        <p>Everything is working as expected.</p>
      </body>
    </html>
  `);
});

/***************************************************************
 *  Create HTTP server & Socket.IO server
 ***************************************************************/
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    credentials: false,
  },
  pingTimeout: 60000, // Increase ping timeout if needed
});

/***************************************************************
 *  Data Structures
 ***************************************************************/

/**
 *  The 'games' object will store all game data.
 *  Structure:
 *
 *  games = {
 *    [gameId]: {
 *      rooms: {
 *        [roomId]: {
 *          id: string,
 *          name: string,
 *          maxPlayers: number,
 *          players: [ { socketId, userName, isReady } ],
 *          isActive: boolean,
 *        }
 *      }
 *    }
 *  }
 */
const games = {};

/**
 *  userList = {
 *    [socketId]: { id: socketId, userName: string },
 *  }
 */
let userList = {};

/***************************************************************
 *  Utility Functions for Game & Room Management
 ***************************************************************/

/**
 * Generate a unique room ID
 */
function generateRoomId() {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * Get or initialize a new game object
 */
function getGame(gameId) {
  if (!games[gameId]) {
    games[gameId] = { rooms: {} };
  }
  return games[gameId];
}

/**
 * Ensure exactly one empty room exists for each game.
 *  - If no empty rooms exist, create one.
 *  - If more than one exists, remove extras.
 */
function ensureSingleEmptyRoom(gameId) {
  const game = getGame(gameId);
  const roomsList = Object.values(game.rooms);

  // Filter rooms that have zero players
  const emptyRooms = roomsList.filter((room) => room.players.length === 0);

  // Remove extra empty rooms if more than one
  while (emptyRooms.length > 1) {
    const roomToRemove = emptyRooms.pop();
    delete game.rooms[roomToRemove.id];
    updateRoomCountForEveryone(gameId);
  }

  // If no empty rooms, create one
  if (emptyRooms.length === 0) {
    const newRoomId = generateRoomId();
    game.rooms[newRoomId] = {
      id: newRoomId,
      name: `Room ${newRoomId}`,
      maxPlayers: 4,
      players: [],
      isActive: false,
    };
  }
}

function updateRoomCountForSingleUser(gameId, socket) {
  const game = getGame(gameId);
  const roomsCount = Object.values(game.rooms).length;
  socket.emit("activeRoomCountResponse", { gameId, roomsCount });
}

function updateRoomCountForEveryone(gameId) {
  const game = getGame(gameId);
  const roomsCount = Object.values(game.rooms).length;
  io.emit("activeRoomCountResponse", { gameId, roomsCount });
}

/**
 * Broadcast an updated list of rooms for the given gameId
 * to all users in the gameId channel (everyone interested in that game).
 */
function broadcastRooms(gameId) {
  const game = getGame(gameId);
  const roomsArray = Object.values(game.rooms);

  // update rooms ActiveCount under that game for everyone
  updateRoomCountForEveryone(Number(gameId));

  io.to(gameId).emit("roomsList", roomsArray);
}

/**
 * Check if all players in a room are ready
 */
function allPlayersReady(room) {
  if (room.players.length === 0) return false;
  return room.players.every((p) => p.isReady);
}

/**
 * Start a countdown for the room. Only notify the room itself,
 * not the entire game.
 */
function startCountdown(gameId, roomId) {
  // We'll emit to a unique channel that combines gameId & roomId
  // to ensure only that room's players get the event.
  const uniqueRoomChannel = `${gameId}-${roomId}`;

  let countdown = 10;
  const intervalId = setInterval(() => {
    countdown--;

    // Emit countdown updates ONLY to this specific room
    io.to(uniqueRoomChannel).emit("countdownUpdate", {
      roomId,
      countdown,
    });

    if (countdown === 0) {
      clearInterval(intervalId);

      // Mark room as active
      const game = getGame(gameId);
      const room = game.rooms[roomId];
      if (room) {
        room.isActive = true;
      }

      // Notify all players in this room that the game is starting
      io.to(uniqueRoomChannel).emit("gameStart", { roomId });
    }
  }, 1000);
}

/***************************************************************
 *  SOCKET.IO EVENT HANDLERS
 ***************************************************************/
io.on("connection", (socket) => {
  console.log(`🟢 A user connected: ${socket.id}`);

  if ((socket.id, Object.keys(games).length > 0)) {
    // Check if the object is not empty
    Object.entries(games).forEach(([key, game]) => {
      console.log("object.entries ~ game", game);
      console.log("Game ID:", key); // The key is the game.id ('1' in this case)
      updateRoomCountForSingleUser(Number(key), socket); // Pass the key as the game.id
    });
  }

  /**
   * 1) Track user info: "user name" event
   *    - The client can provide a userName.
   *    - We store it in 'userList' for quick reference.
   */
  socket.on("user name", (userName, callback) => {
    if (typeof userName !== "string") {
      callback({ success: false, error: "Invalid user name." });
      return;
    }

    console.log(22);
    socket.userName = userName;
    userList[socket.id] = { id: socket.id, userName };
    // Send the full user list to all connected clients
    io.emit("users", Object.values(userList));
  });

  /**
   * 2) Basic chat event (example)
   *    - This simply broadcasts a chat message to everyone except the sender.
   */
  socket.on("chat message", (msg) => {
    socket.broadcast.emit("chat message", msg);
  });

  /**
   * 3) Emit the current user's data upon connection
   *    - You can also put userName or other data here if desired.
   */
  socket.emit("currentUserData", { id: socket.id });

  /**
   * 4) requestRooms: The client asks for the rooms of a particular gameId.
   *    - We join the socket.io "room" named after the gameId
   *      so that they can receive the 'roomsList'.
   *    - Ensure there's exactly one empty room for that game.
   *    - Then broadcast the updated room list to everyone in the game.
   */
  socket.on("requestRooms", (gameId) => {
    // Join the gameId channel
    socket.join(gameId);
    // Make sure there's one empty room for this game
    ensureSingleEmptyRoom(gameId);

    // Broadcast the rooms to everyone in the game
    broadcastRooms(gameId);
  });

  /**
   * 5) joinRoom: The client chooses a specific room inside a game.
   *    - We add the player to that room's 'players' array.
   *    - We also make the socket join a unique channel
   *      combining gameId-roomId for sub-room events (countdown, etc.).
   *    - If the room was empty, ensure there's a new empty room for future players.
   *    - Finally, broadcast the new rooms list to everyone in the game.
   */
  socket.on("joinRoom", ({ gameId, roomId, userName }) => {
    console.log("11");
    const game = getGame(gameId);
    const room = game.rooms[roomId];
    if (!room) return;

    const existingPlayer = room.players.find((p) => p.socketId === socket.id);
    if (!existingPlayer) {
      // Add the player to this room
      room.players.push({ socketId: socket.id, userName, isReady: false });

      // Join the specific sub-room channel => "<gameId>-<roomId>"
      const uniqueRoomChannel = `${gameId}-${roomId}`;
      socket.join(uniqueRoomChannel);

      // If the room was empty before, now it's occupied => ensure a new empty room
      if (room.players.length === 1) {
        ensureSingleEmptyRoom(gameId);
      }
    }

    // Broadcast the updated rooms list to everyone in the game
    broadcastRooms(gameId);
  });

  /**
   * 6) leaveRoom: The client leaves a specific room.
   *    - We remove them from that room's 'players'.
   *    - If the room is empty afterward, we may remove it
   *      (as long as there's another empty room already).
   */
  // E) Leave a specific room
  socket.on("leaveRoom", ({ gameId, roomId }) => {
    // Get the game and the specific room

    console.log(
      "🥺 User Has left the room leaveRoom",
      socket.id,
      gameId,
      roomId
    );
    const game = getGame(gameId);
    const room = game.rooms[roomId];
    if (!room) return;

    // 1. Remove the socket from the Socket.IO room channel
    //    e.g. "myGameId-myRoomId"
    const uniqueRoomChannel = `${gameId}-${roomId}`;
    socket.leave(uniqueRoomChannel);

    // 2. Remove the player from the in-memory room data
    room.players = room.players.filter((p) => p.socketId !== socket.id);

    // 3. If the room is now empty, decide whether to keep or remove it
    const emptyRooms = Object.values(game.rooms).filter(
      (r) => r.players.length === 0
    );

    // - If there's more than one empty room, remove this one
    if (room.players.length === 0) {
      if (emptyRooms.length > 1) {
        delete game.rooms[roomId];
        updateRoomCountForEveryone(gameId);
      }
    }

    // 4. Broadcast the updated room list to everyone in this game
    broadcastRooms(gameId);
  });

  /**
   * 7) toggleReady: The client toggles their readiness status.
   *    - We update that player's readiness in the room.
   *    - If *all* players are ready, start the countdown
   *      (only notify players in this sub-room).
   */
  socket.on("toggleReady", ({ gameId, roomId, isReady }) => {
    const game = getGame(gameId);
    const room = game.rooms[roomId];
    if (!room) return;

    // Find the player in the room
    const player = room.players.find((p) => p.socketId === socket.id);
    if (player) {
      player.isReady = isReady;
    }

    // If all players in this room are ready, start countdown
    if (allPlayersReady(room)) {
      startCountdown(gameId, roomId);
    }

    // Broadcast the updated rooms list to everyone in the game
    broadcastRooms(gameId);
  });

  /**
   * 8) Handle disconnection
   *    - Remove the user from userList.
   *    - Remove them from any rooms they might be in.
   *    - If a room becomes empty, remove or keep only one empty room.
   */

  socket.on("disconnect", () => {
    console.log(`🔴 A user disconnected: ${socket.id}`);

    // Remove user from userList
    delete userList[socket.id];
    // Broadcast the updated user list
    io.emit("users", Object.values(userList));
  });
});

/***************************************************************
 *  Start HTTP Server
 ***************************************************************/
httpServer.listen(PORT, () => {
  console.log(`✅ HTTP Server is running on port ${PORT}`);
});
