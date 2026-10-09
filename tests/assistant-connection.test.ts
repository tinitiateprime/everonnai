import test from "node:test";
import assert from "node:assert/strict";
import { connectAssistant } from "../lib/assistant-connection";

test("closing or timing out a pending assistant connection releases any late session", async () => {
  const controller = new AbortController();
  let release!: (value: { endSession(): Promise<void> }) => void;
  let ended = 0;
  const pending = new Promise<{ endSession(): Promise<void> }>((resolve) => {
    release = resolve;
  });
  const cancelled = connectAssistant(pending, controller.signal);
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  release({
    endSession: async () => {
      ended++;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(ended, 1);

  let late!: typeof release;
  const timed = connectAssistant(
    new Promise<{ endSession(): Promise<void> }>((resolve) => {
      late = resolve;
    }),
    new AbortController().signal,
    5,
  );
  await assert.rejects(timed, /timed out/);
  late({
    endSession: async () => {
      ended++;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(ended, 2);
});
test("successful connections stay open, and rejected/already-aborted connections settle safely", async () => {
  let ended = 0;
  const session = {
    endSession: async () => {
      ended++;
    },
  };
  const controller = new AbortController();
  assert.equal(
    await connectAssistant(Promise.resolve(session), controller.signal),
    session,
  );
  controller.abort();
  assert.equal(ended, 0);
  await assert.rejects(
    connectAssistant(
      Promise.reject(new Error("Provider failure")),
      new AbortController().signal,
    ),
    /Provider failure/,
  );
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    connectAssistant(Promise.resolve(session), aborted.signal),
    { name: "AbortError" },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(ended, 1);
});
