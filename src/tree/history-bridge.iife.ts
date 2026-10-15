/** MAIN-world bridge: the credential stays here; only current-chat history crosses worlds. */
const bridgeWindow = window as Window & { __DSE_HISTORY_BRIDGE__?: boolean };
if (!bridgeWindow.__DSE_HISTORY_BRIDGE__) {
  bridgeWindow.__DSE_HISTORY_BRIDGE__ = true;
  let active: { requestId: string; controller: AbortController } | null = null;
  window.addEventListener("message", async (event) => {
    const request = event.data;
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      typeof request?.requestId !== "string" ||
      request.requestId.length > 100
    )
      return;
    if (request.type === "dse:history-cancel") {
      if (active && active.requestId === request.requestId) active.controller.abort();
      return;
    }
    if (request.type !== "dse:history-request") return;
    const match = location.pathname.match(/^\/a\/chat\/s\/([a-f0-9-]+)\/?$/i);
    const sessionId = match?.[1];
    if (!sessionId || request.conversationId !== sessionId) return;
    active?.controller.abort();
    const controller = new AbortController();
    active = { requestId: request.requestId, controller };
    const timer = window.setTimeout(() => controller.abort(), 9000);
    try {
      const raw = localStorage.getItem("userToken");
      if (!raw) throw new Error("Sign in to load the full conversation tree.");
      let token = raw;
      try {
        const parsed = JSON.parse(raw);
        token = typeof parsed === "string" ? parsed : parsed.value;
      } catch {
        /* plain token */
      }
      if (typeof token !== "string" || !token) throw new Error("Could not read the sign-in state.");
      const response = await fetch(`/api/v0/chat/history_messages?chat_session_id=${encodeURIComponent(sessionId)}`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Conversation history is temporarily unavailable.");
      const data = await response.json();
      if (location.pathname.match(/^\/a\/chat\/s\/([a-f0-9-]+)\/?$/i)?.[1] !== sessionId) return;
      window.postMessage(
        { type: "dse:history-response", requestId: request.requestId, conversationId: sessionId, data },
        location.origin,
      );
    } catch {
      window.postMessage(
        {
          type: "dse:history-response",
          requestId: request.requestId,
          conversationId: sessionId,
          error: "Could not load full history. Showing rendered messages; try refreshing.",
        },
        location.origin,
      );
    } finally {
      if (active?.controller === controller) active = null;
      clearTimeout(timer);
    }
  });
}
export {};
