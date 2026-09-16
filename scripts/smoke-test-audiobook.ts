/**
 * End-to-end smoke test against a running instance of this API
 * (`npm run dev` in another terminal first). Exercises the full audiobook
 * flow: create Title -> upload source -> chapter draft -> confirm chapter
 * -> poll status until ready -> stream audio.
 *
 * Uses real Gemini API calls (text + TTS) — costs quota and takes several
 * minutes for the TTS portion. Requires a real Firebase ID token: this
 * script mints one itself via a custom token + the Identity Toolkit REST
 * API, using GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_SERVICE_ACCOUNT_PATH
 * for the Admin SDK and FIREBASE_WEB_API_KEY for the exchange.
 */
import { readFileSync } from "node:fs";

const BASE_URL = process.env.SMOKE_TEST_BASE_URL ?? "http://localhost:3000";
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY;
const SERVICE_ACCOUNT_PATH =
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;

function log(step: string, detail?: unknown) {
  console.log(`\n=== ${step} ===`);
  if (detail !== undefined) console.log(detail);
}

async function mintIdToken(): Promise<string> {
  if (!WEB_API_KEY) throw new Error("FIREBASE_WEB_API_KEY is required to mint a test ID token");
  if (!SERVICE_ACCOUNT_PATH) throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH is required");

  const { initializeApp, cert, deleteApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));
  const app = initializeApp({ credential: cert(serviceAccount) }, "smoke-test-audiobook");

  try {
    const customToken = await getAuth(app).createCustomToken("smoke-test-audiobook-user");
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      },
    );
    if (!res.ok) throw new Error(`Custom token exchange failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { idToken: string };
    return data.idToken;
  } finally {
    await deleteApp(app);
  }
}

async function api<T>(
  idToken: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

const SAMPLE_CHAPTER = `Chapter One: The Signal

The lighthouse had not worked in a decade, but Mara climbed it anyway, her boots ringing on the iron stairs.

"You shouldn't be up here," Dov called from the doorway below, "it isn't safe."

"Neither is standing still," she said, not looking back.

At the top, the lamp room was thick with dust and gull feathers. Mara pressed her palm to the cold glass and watched the dark water for the light that had brought them all this way.

"There," she whispered, pointing at a flicker on the horizon.`;

async function main() {
  log("Minting a real Firebase ID token");
  const idToken = await mintIdToken();
  log("got ID token", `${idToken.slice(0, 20)}...`);

  log("1. Create Title");
  const title = await api<any>(idToken, "POST", "/audiobooks", {
    title: "The Lighthouse Keeper's Daughter",
    description: "A short maritime mystery, for smoke-testing the audiobook pipeline.",
  });
  log("created title", title.id);

  log("2. Upload chapter source text");
  const source = await api<any>(idToken, "POST", `/audiobooks/${title.id}/sources`, {
    title: "Chapter One draft",
    contents: SAMPLE_CHAPTER,
  });
  log("created source", source.id);

  log("3. Generate chapter draft (real Gemini text call)");
  const { draft } = await api<any>(idToken, "POST", `/audiobooks/${title.id}/chapters/draft`, {
    sourceId: source.id,
  });
  log("got draft", {
    name: draft.name,
    synopsis: draft.synopsis,
    sceneCount: draft.scenes.length,
    characters: draft.characters.map((c: any) => c.name),
  });

  log("4. Confirm chapter (kicks off generation)");
  const chapter = await api<any>(idToken, "POST", `/audiobooks/${title.id}/chapters`, {
    sourceId: source.id,
    draft,
  });
  log("chapter created, status:", chapter.status);

  log("5. Poll status until ready");
  let status = chapter.status;
  while (status === "generating") {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await api<any>(idToken, "GET", `/audiobooks/${title.id}/chapters/${chapter.id}/status`);
    status = s.status;
    console.log("  status:", s.status, s.progress, s.error ?? "");
  }
  if (status !== "ready") throw new Error(`Chapter ended in status: ${status}`);

  log("6. Fetch final Title (merged Cast) and Chapter");
  const finalTitle = await api<any>(idToken, "GET", `/audiobooks/${title.id}`);
  console.log("cast:", finalTitle.cast.map((c: any) => `${c.name} (${c.voice})`));

  log("7. Stream audio (expect a real WAV response, live-generated)");
  const audioRes = await fetch(
    `${BASE_URL}/audiobooks/${title.id}/chapters/${chapter.id}/audio/stream`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );
  if (!audioRes.ok) throw new Error(`Audio stream failed: ${audioRes.status} ${await audioRes.text()}`);
  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
  console.log("audio bytes:", audioBuffer.length, "content-type:", audioRes.headers.get("content-type"));

  log("Smoke test passed", { titleId: title.id, chapterId: chapter.id });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
