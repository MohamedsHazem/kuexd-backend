// gameRegistry.js

const biggestTomato = require("../sockets/games/biggestTomato");
// We'll import our new Agar.io logic below
const agarIo = require("../sockets/games/agarIo");

function initializeGame(gameId, game, room, io) {
  const gameIdNumber = parseInt(gameId, 10);

  switch (gameIdNumber) {
    case 1: // Biggest Tomato
      console.log("initializeGame -> biggestTomato.startBiggestTomatoRoom");
      biggestTomato.startBiggestTomatoRoom(game, room);
      biggestTomato.broadcastGameState(io, gameId, room.id, room);
      return;

    case 2: // Agar.io Clone
      console.log("initializeGame -> agarIo.startAgarIoRoom");
      agarIo.startAgarIoRoom(game, room);
      agarIo.broadcastGameState(io, gameId, room.id, room);
      return;

    default:
      throw new Error(`Game ID ${gameId} not recognized`);
  }
}

module.exports = {
  initializeGame,
};
