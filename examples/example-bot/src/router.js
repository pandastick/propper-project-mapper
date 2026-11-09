// Synthetic example code for `xpm check`. Not a real bot.
function fastPath(message) { return message.text.startsWith("/"); }
function replyToCommand(message) { return `ran ${message.text}`; }
module.exports = { fastPath, replyToCommand };
