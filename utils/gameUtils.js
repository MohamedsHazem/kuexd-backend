/************************************
 * utils/gameUtils.js
 ************************************/

const { initializeGame } = require("./gameRegistry");

function generateRoomId() {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * Returns the game object, ensuring it has
 *  { rooms: {}, activeRooms: {} }
 */
function getGame(gameId, games) {
  if (!games[gameId]) {
    games[gameId] = { rooms: {}, activeRooms: {} };
  }
  // Ensure activeRooms always exists
  if (!games[gameId].activeRooms) {
    games[gameId].activeRooms = {};
  }
  return games[gameId];
}

/**
 * Ensure there's exactly one empty (lobby) room for the given game.
 */
function ensureSingleEmptyRoom(gameId, games, io) {
  const game = getGame(gameId, games);
  const roomsList = Object.values(game.rooms);

  const emptyRooms = roomsList.filter((room) => room.players.length === 0);

  // Remove extra empty rooms if more than 1
  while (emptyRooms.length > 1) {
    const roomToRemove = emptyRooms.pop();
    delete game.rooms[roomToRemove.id];
    updateRoomCountForEveryone(gameId, games, io);
  }

  // If no empty room, create one
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

function updateRoomCountForSingleUser(gameId, socket, games, io) {
  const game = getGame(gameId, games);
  const roomsCount = Object.values(game.rooms).length;
  socket.emit("activeRoomCountResponse", { gameId, roomsCount });
}

function updateRoomCountForEveryone(gameId, games, io) {
  const game = getGame(gameId, games);
  const roomsCount = Object.values(game.rooms).length;
  io.emit("activeRoomCountResponse", { gameId, roomsCount });
}

/**
 * Broadcast the list of LOBBY rooms only (active rooms are hidden)
 */
function broadcastRooms(gameId, games, io) {
  const game = getGame(gameId, games);
  const roomsArray = Object.values(game.rooms);
  updateRoomCountForEveryone(gameId, games, io);
  io.to(gameId).emit("roomsList", roomsArray);
}

/**
 * Checks if ALL players in a room are ready
 */
function allPlayersReady(room) {
  if (room.players.length === 0) return false;
  return room.players.every((p) => p.isReady);
}

/**
 * Start a 10-second countdown, then
 * 1) Move the room from game.rooms -> game.activeRooms
 * 2) Call initializeGame()
 */
function startCountdown(gameId, roomId, games, io) {
  const uniqueRoomChannel = `${gameId}-${roomId}`;
  let countdown = 10;

  console.log(
    `[Server] startCountdown -> Starting countdown for room ${uniqueRoomChannel}`
  );

  const intervalId = setInterval(() => {
    countdown--;
    console.log(`[Server] countdown: ${countdown}`);
    io.to(uniqueRoomChannel).emit("countdownUpdate", { roomId, countdown });

    if (countdown === 0) {
      clearInterval(intervalId);

      const game = getGame(gameId, games);
      const lobbyRoom = game.rooms[roomId];
      if (lobbyRoom) {
        // Mark the room as active
        lobbyRoom.isActive = true;

        // Move the room from "rooms" to "activeRooms"
        game.activeRooms[roomId] = lobbyRoom;
        delete game.rooms[roomId];

        // Inform the lobby channel that the game has started
        io.to(uniqueRoomChannel).emit("gameStart", { roomId });
        console.log(
          `[Server] countdown -> Moved roomId=${roomId} to activeRooms for gameId=${gameId}`
        );

        // Actually initialize the game (deal cards, etc.)
        initializeGame(gameId, game, lobbyRoom, io);
      }
    }
  }, 1000);
}

module.exports = {
  generateRoomId,
  getGame,
  ensureSingleEmptyRoom,
  updateRoomCountForSingleUser,
  updateRoomCountForEveryone,
  broadcastRooms,
  allPlayersReady,
  startCountdown,
};
