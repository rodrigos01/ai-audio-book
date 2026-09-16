import { getFirestore } from "firebase-admin/firestore";
import { firebaseApp } from "./firebase";
import { env } from "./env";

// Same Firebase project/credentials as the Podcast side (firebase.ts), just a
// different named Firestore database — Titles/Chapters/Cast/Scenes/Sources
// have their own shape (see audiobook-specs.md), unrelated to
// Podcasts/Episodes/Hosts/Guests.
export const audiobookFirestore = getFirestore(firebaseApp, env.AUDIOBOOKS_FIRESTORE_DATABASE_ID);
