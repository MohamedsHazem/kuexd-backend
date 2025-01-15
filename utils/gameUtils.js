// utils/gameUtils.js
function generateRoomId() {
  return Math.random().toString(36).substring(2, 9);
}

function getGame(gameId, games) {
  if (!games[gameId]) {
    games[gameId] = { rooms: {} };
  }
  return games[gameId];
}

function ensureSingleEmptyRoom(gameId, games) {
  const game = getGame(gameId, games);
  const roomsList = Object.values(game.rooms);

  const emptyRooms = roomsList.filter((room) => room.players.length === 0);

  while (emptyRooms.length > 1) {
    const roomToRemove = emptyRooms.pop();
    delete game.rooms[roomToRemove.id];
    updateRoomCountForEveryone(gameId, games, io);
  }

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

function updateRoomCountForSingleUser(gameId, socket, games) {
  const game = getGame(gameId, games);
  const roomsCount = Object.values(game.rooms).length;
  socket.emit("activeRoomCountResponse", { gameId, roomsCount });
}

function updateRoomCountForEveryone(gameId, games, io) {
  const game = getGame(gameId, games);
  const roomsCount = Object.values(game.rooms).length;
  io.emit("activeRoomCountResponse", { gameId, roomsCount });
}

function broadcastRooms(gameId, games, io) {
  const game = getGame(gameId, games);
  const roomsArray = Object.values(game.rooms);
  updateRoomCountForEveryone(gameId, games, io);
  io.to(gameId).emit("roomsList", roomsArray);
}

function allPlayersReady(room) {
  if (room.players.length === 0) return false;
  return room.players.every((p) => p.isReady);
}

function startCountdown(gameId, roomId, io) {
  const uniqueRoomChannel = `${gameId}-${roomId}`;
  let countdown = 10;

  const intervalId = setInterval(() => {
    countdown--;
    io.to(uniqueRoomChannel).emit("countdownUpdate", { roomId, countdown });

    if (countdown === 0) {
      clearInterval(intervalId);
      const game = getGame(gameId, games);
      const room = game.rooms[roomId];
      if (room) {
        room.isActive = true;
      }
      io.to(uniqueRoomChannel).emit("gameStart", { roomId });
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
