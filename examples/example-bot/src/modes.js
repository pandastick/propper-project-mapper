// Synthetic example code for `xpm check`. Not a real bot.
function currentMode(chat) { return chat.mode || "normal"; }
function holdForPlanner(message, queue) { queue.push(message); }
module.exports = { currentMode, holdForPlanner };
