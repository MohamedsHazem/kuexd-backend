// gameRegistry.js

const games = {};

function loadGameModule(gameId) {
  switch (gameId) {
    case 1:
      return (
        games.biggestTomato ||
        (games.biggestTomato = require("../sockets/games/biggestTomato"))
      );
    case 2:
      return (
        games.agarIo || (games.agarIo = require("../sockets/games/agarIo"))
      );
    default:
      throw new Error(`Game ID ${gameId} not recognized`);
  }
}

function initializeGame(gameId, game, room, io) {
  const gameIdNumber = parseInt(gameId, 10);

  try {
    const gameModule = loadGameModule(gameIdNumber);

    switch (gameIdNumber) {
      case 1: // Biggest Tomato
        console.log("initializeGame -> biggestTomato.startBiggestTomatoRoom");
        gameModule.startBiggestTomatoRoom(game, room);
        gameModule.broadcastGameState(io, gameId, room.id, room);
        return;

      case 2: // Agar.io Clone
        console.log("initializeGame -> agarIo.startAgarIoRoom");
        gameModule.startAgarIoRoom(game, room);
        gameModule.broadcastGameState(io, gameId, room.id, room);
        return;

      default:
        throw new Error(`Game ID ${gameId} not recognized`);
    }
  } catch (error) {
    console.error(`Error loading game module ${gameId}:`, error);
    throw error;
  }
}

module.exports = {
  initializeGame,
};
