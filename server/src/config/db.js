import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 15000,
    // Atlas free-tier clusters (and corporate networks/proxies) can drop an
    // idle-looking connection mid-batch; a longer socket timeout and a small
    // pool make that far less likely during scripts that do many sequential
    // small writes, like the register importer.
    socketTimeoutMS: 45000,
    connectTimeoutMS: 15000,
    maxPoolSize: 10,
    retryWrites: true,
    retryReads: true,
  });
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
}