import mongoose from "mongoose";
import { GridFSBucket } from "mongodb";
import dbConnect from "./db.js";

/**
 * Upload a file buffer to MongoDB GridFS.
 * Returns the ObjectId of the uploaded file.
 */
export async function storeFileGridFS(buffer, fileName, chatId) {
  await dbConnect();
  const db     = mongoose.connection.db;
  const bucket = new GridFSBucket(db, { bucketName: "userfiles" });

  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(fileName, {
      metadata: { chatId: String(chatId), uploadedAt: new Date() },
    });
    uploadStream.on("finish", () => resolve(uploadStream.id));
    uploadStream.on("error",  reject);
    uploadStream.end(buffer);
  });
}

/**
 * Download a file from GridFS by ObjectId.
 * Returns a Buffer.
 */
export async function getFileGridFS(gridfsId) {
  await dbConnect();
  const db     = mongoose.connection.db;
  const bucket = new GridFSBucket(db, { bucketName: "userfiles" });

  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = bucket.openDownloadStream(
      new mongoose.Types.ObjectId(String(gridfsId))
    );
    stream.on("data",  (chunk) => chunks.push(chunk));
    stream.on("end",   () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/**
 * Delete a file from GridFS by ObjectId.
 */
export async function deleteFileGridFS(gridfsId) {
  await dbConnect();
  const db     = mongoose.connection.db;
  const bucket = new GridFSBucket(db, { bucketName: "userfiles" });
  await bucket.delete(new mongoose.Types.ObjectId(String(gridfsId)));
}
