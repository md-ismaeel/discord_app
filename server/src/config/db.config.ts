import mongoose from "mongoose";
import { getEnv } from "./env.config.js";

// ─── State ───────────────────────────────────────────────────────────────────
let isConnected = false;

// ─── Connection ──────────────────────────────────────────────────────────────
export const connectDb = async (): Promise<void> => {
  if (isConnected) {
    console.log("MongoDB already connected");
    return;
  }

  const uri = getEnv("MONGODB_URI");

  try {
    await mongoose.connect(uri, {
      // Keeps connection pool lean in serverless / single-process use
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    isConnected = true;
    console.log("MongoDB connected successfully!");

    // Register listeners AFTER a successful connect so they track
    // the live connection rather than being set up on a dead socket.
    mongoose.connection.on("error", (err: Error) => {
      console.error("MongoDB connection error:", err.message);
      isConnected = false;
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("MongoDB disconnected");
      isConnected = false;
    });

    mongoose.connection.on("reconnected", () => {
      console.log("MongoDB reconnected");
      isConnected = true;
    });
  } catch (err) {
    console.error("MongoDB connection failed:", (err as Error).message);
    process.exit(1);
  }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the current live connection status. */
export const getDbStatus = (): boolean => isConnected;

/** Gracefully closes the Mongoose connection. */
export const closeDb = async (): Promise<void> => {
  if (!isConnected) return;
  await mongoose.connection.close();
  isConnected = false;
  console.log("MongoDB connection closed");
};