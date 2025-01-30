/************************************
 * utils/gameRegistry.js
 ************************************/

const games = {};

function loadGameModule(gameId) {
  switch (gameId) {
    case 1:
      // Biggest Tomato
      if (!games.biggestTomato) {
        games.biggestTomato = require("../sockets/games/biggestTomato");
      }
      return games.biggestTomato;

    case 2:
      // Agar.io
      if (!games.agarIo) {
        games.agarIo = require("../sockets/games/agarIo.js");
      }
      return games.agarIo;

    default:
      throw new Error(`Game ID ${gameId} not recognized`);
  }
}

/**
 * Called after the countdown finishes. Each game
 * module's “startGame” logic is triggered.
 */
function initializeGame(gameId, game, room, io) {
  const gameIdNumber = parseInt(gameId, 10);
  const gameModule = loadGameModule(gameIdNumber);

  // For demonstration, each game has a “startXxxRoom”
  switch (gameIdNumber) {
    case 1: // Biggest Tomato
      console.log("initializeGame -> biggestTomato.startBiggestTomatoRoom");
      gameModule.startBiggestTomatoRoom(game, room);
      // Immediately broadcast the initial state
      gameModule.broadcastGameState(io, gameId, room.id, room);
      return;

    case 2: // Agar.io clone
      console.log("initializeGame -> agarIo.startAgarIoRoom");
      gameModule.startAgarIoRoom(game, room, games);
      // Immediately broadcast the initial state
      gameModule.broadcastGameState(io, gameId, room.id, room);
      return;

    default:
      throw new Error(`Game ID ${gameId} not recognized`);
  }
}

/**
 * Generic function to broadcast game state for a given room.
 */
function broadcastGameState(gameId, io, room) {
  const gameIdNumber = parseInt(gameId, 10);
  const gameModule = loadGameModule(gameIdNumber);

  if (typeof gameModule.broadcastGameState === "function") {
    gameModule.broadcastGameState(io, gameId, room.id, room);
  }
}

/**
 * Generic function to end a game (cleanup).
 */
function endGame(gameId, game, room, games) {
  const gameIdNumber = parseInt(gameId, 10);
  const gameModule = loadGameModule(gameIdNumber);

  // Each game has its own cleanup method:
  // Agar.io => endAgarIoRoom
  // BiggestTomato => endBiggestTomatoRoom
  if (gameIdNumber === 2 && typeof gameModule.endAgarIoRoom === "function") {
    // Agar.io
    gameModule.endAgarIoRoom(game, room, games);
  } else if (
    gameIdNumber === 1 &&
    typeof gameModule.endBiggestTomatoRoom === "function"
  ) {
    // Biggest Tomato
    gameModule.endBiggestTomatoRoom(game, room, games);
  } else {
    console.log(`No specific endGame function found for gameId=${gameId}`);
  }
}

module.exports = {
  initializeGame,
  broadcastGameState,
  endGame,
};
