import { NextResponse } from 'next/server';
import dbConnect from '../../../lib/db';
import { encrypt, decrypt } from '../../../lib/encryption';

export async function GET() {
  const results = {};

  // MongoDB check
  try {
    await dbConnect();
    results.database = "ok";
  } catch (error) {
    console.error("MongoDB connection error:", error);
    results.database = "FAILED";
    results.databaseError = error.message;
  }

  // Encryption round-trip check
  try {
    const plaintext = "health-check";
    const ciphertext = encrypt(plaintext);
    const decrypted = decrypt(ciphertext);
    results.encryption = decrypted === plaintext ? "ok" : "FAILED";
  } catch (error) {
    console.error("Encryption check error:", error);
    results.encryption = "FAILED";
    results.encryptionError = error.message;
  }

  const allOk = Object.values(results).every((v) => v === "ok");

  return NextResponse.json(results, { status: allOk ? 200 : 500 });
}
