import mongoose from "mongoose";
import { getEnv } from "./env.config";

let isConnected = false;

export const connectDb = async (): Promise<void> => {
  if (isConnected) {
    console.log("MongoDB already connected");
    return;
  }

  const uri = getEnv("MONGODB_URI");

  try {
    await mongoose.connect(uri);
    isConnected = true;
    console.log("MongoDB connected successfully!");

    mongoose.connection.on("error", (err: Error) => {
      console.error("MongoDB error:", err);
      isConnected = false;
    });

    mongoose.connection.on("disconnected", () => {
      console.log("MongoDB disconnected");
      isConnected = false;
    });
  } catch (err) {
    console.error("MongoDB connection failed:", (err as Error)?.message);
    process.exit(1);
  }
};
