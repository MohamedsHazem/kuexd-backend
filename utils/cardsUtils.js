/************************************
 * utils/cardsUtils.js
 ************************************/

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function getRandomCard(deck) {
  if (!deck.length) return null;
  const index = Math.floor(Math.random() * deck.length);
  return deck.splice(index, 1)[0];
}

module.exports = {
  shuffleDeck,
  getRandomCard,
};
