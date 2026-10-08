import mongoose from 'mongoose';

import { env } from './env.js';

/**
 * Establishes the Mongoose connection to the configured MongoDB URI.
 *
 * The connection string is expected to target a replica set so that
 * multi-document ACID transactions / sessions are available (Requirement 7).
 *
 * Connection state is logged without ever exposing secrets such as
 * credentials embedded in the URI (Requirement 13.3).
 *
 * @returns {Promise<typeof mongoose>} the connected mongoose instance
 */
let listenersRegistered = false;

function registerConnectionListeners() {
  if (listenersRegistered) {
    return;
  }
  listenersRegistered = true;

  const connection = mongoose.connection;

  connection.on('connected', () => {
    console.log(
      `[db] connected (host=${connection.host} db=${connection.name})`,
    );
  });

  connection.on('error', (err) => {
    // Log only the message, never the URI or credentials.
    console.error(`[db] connection error: ${err?.message ?? 'unknown error'}`);
  });

  connection.on('disconnected', () => {
    console.log('[db] disconnected');
  });
}

export async function connectDB() {
  // Surface connection-lifecycle events with secret-free logging.
  registerConnectionListeners();

  await mongoose.connect(env.MONGO_URI);

  return mongoose;
}

/**
 * Closes the active Mongoose connection.
 *
 * Primarily used by the test suite to tear down connections cleanly between
 * runs; safe to call when no connection is open.
 *
 * @returns {Promise<void>}
 */
export async function disconnectDB() {
  await mongoose.disconnect();
  console.log('[db] connection closed');
}
