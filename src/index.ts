import { env } from "./config/env";
import { createApp } from "./app";

// Long-lived TTS streams can drop mid-transfer (e.g. a transient
// ECONNRESET from the underlying fetch transport) in a way that bypasses
// normal promise rejection handling and would otherwise crash the whole
// process — taking down every other in-flight request with it. Log and
// keep running rather than let one flaky connection kill the server.
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (process kept alive):", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection (process kept alive):", reason);
});

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`AI Podcast API listening on port ${env.PORT}`);
});
