import User from "../models/User.js";
import { sendTelegramMessage } from "./telegram.js";

export const ESCAPE_WORDS = ["cancel", "stop", "exit", "quit", "/cancel"];

export function isEscapeInput(text) {
  return ESCAPE_WORDS.includes(text.trim().toLowerCase());
}

export async function sendEscapeMessage(chatId, context) {
  const messages = {
    onboarding:
      "✅ Setup paused.\n\n" +
      "Your name is saved — everything else can be configured later.\n\n" +
      "_Example:_ `/start` to continue setup, or just start chatting.",

    emailSetup:
      "✅ Email setup cancelled.\n\n" +
      "No account was connected.\n\n" +
      "_Example:_ `/connectmail` to try again anytime.",

    deleteAccount:
      "✅ Account deletion cancelled.\n\n" +
      "Your account and all data are safe. 🔒\n\n" +
      "_Example:_ `/help` to see what you can do.",

    personaSetup:
      "✅ Persona creation cancelled.\n\n" +
      "Nothing was saved.\n\n" +
      "_Example:_ `/personas` to see available personas.",

    default:
      "✅ Cancelled.\n\n" +
      "_Example:_ Type `/help` to see all commands.",
  };

  await sendTelegramMessage(messages[context] || messages.default, chatId);
}
