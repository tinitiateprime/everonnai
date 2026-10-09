type Connection = { endSession(): Promise<unknown> };

// The SDK cannot cancel startSession. End any session which resolves after cancellation/timeout.
export function connectAssistant<T extends Connection>(
  pending: Promise<T>,
  signal: AbortSignal,
  timeoutMs = 45000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(error);
    };
    const abort = () =>
      fail(
        signal.reason ?? new DOMException("Connection cancelled", "AbortError"),
      );
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () =>
        fail(
          new Error(
            "The assistant connection timed out. Please reconnect or use chat.",
          ),
        ),
      timeoutMs,
    );
    pending.then((connection) => {
      if (finished || signal.aborted) {
        void connection.endSession().catch(() => {});
        return;
      }
      finished = true;
      cleanup();
      resolve(connection);
    }, fail);
    if (signal.aborted) abort();
  });
}
