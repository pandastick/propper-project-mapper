// Synthetic example code for `xpm check`. Not a real bot.
function receiveUpdate(update) { return update; }
function isDuplicate(update, seen) { return seen.has(update.id); }
module.exports = { receiveUpdate, isDuplicate };
