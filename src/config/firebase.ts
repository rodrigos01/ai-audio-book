import path from "node:path";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { env } from "./env";

const serviceAccountPath = path.isAbsolute(env.FIREBASE_SERVICE_ACCOUNT_PATH)
  ? env.FIREBASE_SERVICE_ACCOUNT_PATH
  : path.join(process.cwd(), env.FIREBASE_SERVICE_ACCOUNT_PATH);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const serviceAccount = require(serviceAccountPath);

export const firebaseApp = initializeApp({
  credential: cert(serviceAccount),
  projectId: env.FIREBASE_PROJECT_ID,
  storageBucket: env.FIREBASE_STORAGE_BUCKET,
});

export const firestore = getFirestore(firebaseApp, env.FIRESTORE_DATABASE_ID);
export const storageBucket = getStorage(firebaseApp).bucket();
