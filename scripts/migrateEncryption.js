/**
 * One-time migration script: encrypts plain-text OAuth tokens and IMAP passwords
 * for all existing users in MongoDB.
 *
 * Usage:
 *   ENCRYPTION_KEY=<64-char-hex> MONGODB_URI=<uri> node scripts/migrateEncryption.js
 *
 * Safe to re-run — already-encrypted values are skipped via isEncrypted() check.
 */

import mongoose from "mongoose";
import { encrypt, isEncrypted } from "../src/lib/encryption.js";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI is required");
  process.exit(1);
}

// Minimal schema — only the fields we need
const emailAccountSchema = new mongoose.Schema({
  provider:          String,
  emailAddress:      String,
  oauthAccessToken:  String,
  oauthRefreshToken: String,
  imapPassword:      String,
}, { _id: true });

const userSchema = new mongoose.Schema({
  chatId:        String,
  emailAccounts: [emailAccountSchema],
});

const User = mongoose.model("User", userSchema);

async function migrate() {
  await mongoose.connect(MONGODB_URI);
  console.log("[Migration] Connected to MongoDB");

  const users = await User.find({ "emailAccounts.0": { $exists: true } });
  console.log(`[Migration] Found ${users.length} user(s) with email accounts`);

  let totalUpdated = 0;

  for (const user of users) {
    let dirty = false;

    for (const account of user.emailAccounts) {
      // OAuth providers
      if (account.oauthAccessToken && !isEncrypted(account.oauthAccessToken)) {
        account.oauthAccessToken = encrypt(account.oauthAccessToken);
        dirty = true;
      }
      if (account.oauthRefreshToken && !isEncrypted(account.oauthRefreshToken)) {
        account.oauthRefreshToken = encrypt(account.oauthRefreshToken);
        dirty = true;
      }
      // IMAP providers
      if (account.imapPassword && !isEncrypted(account.imapPassword)) {
        account.imapPassword = encrypt(account.imapPassword);
        dirty = true;
      }
    }

    if (dirty) {
      await user.save();
      totalUpdated++;
      console.log(`[Migration] Encrypted credentials for chatId ${user.chatId}`);
    }
  }

  console.log(`[Migration] Done. ${totalUpdated}/${users.length} user(s) updated.`);
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("[Migration] Fatal error:", err);
  process.exit(1);
});
