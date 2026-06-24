import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  // eslint-disable-next-line no-var
  var mongooseCache: MongooseCache | undefined;
}

const cache = global.mongooseCache ?? { conn: null, promise: null };

if (!global.mongooseCache) {
  global.mongooseCache = cache;
}

export async function connectDb() {
  if (cache.conn) return cache.conn;

  if (!uri) {
    throw new Error("MONGODB_URI is required.");
  }

  cache.promise ??= mongoose.connect(uri, {
    bufferCommands: false,
    maxPoolSize: 5
  });

  cache.conn = await cache.promise;
  return cache.conn;
}
