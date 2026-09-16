import { Hono } from "hono";
import { cors } from "hono/cors";
import { randomUUID } from "node:crypto";
import { cfg } from "./config.js";
import { agentEventToSse } from "./sse.js";
import { runAgent, newSessionId, snapshotSession } from "./agent/run.js";
import { applyAgentEvent, emptyWorkflowState, workflowHasData } from "./agent/workflow-trace.js";
import { createConversation, listConversations, getConversation, deleteConversation, addMessage, updateTitle, belongsToDevice, titleFromMessage, saveConversationState, clearConversationState, } from "./storage/conversations.js";
import { parseConversationMessagePost } from "./storage/conversation-messages.js";
import { isCollectionRequest } from "./agent/gate.js";
import { parseEntities } from "./context/memory.js";
import { resetSession } from "./context/session.js";
import { sanitizeUserVisibleText } from "./agent/protocol.js";
import { runWithOpenCodeSession } from "./llm/session-context.js";
import { pingQptmMcp, qptmMcpConnected } from "./mcp/hub.js";
const app = new Hono();
app.use("*", cors({
    origin: cfg.corsOrigins.includes("*") ? "*" : cfg.corsOrigins,
    allowHeaders: ["Content-Type", "X-Device-Id", "X-Trace-Id"],
    exposeHeaders: ["X-Session-Id", "X-Conversation-Id", "X-Trace-Id"],
}));
function deviceId(c) {
    const id = c.req.header("X-Device-Id");
    return id?.trim() || null;
}
app.get("/health", async (c) => {
    const mcpOk = await pingQptmMcp();
    let backend = { status: "unknown" };
    try {
        const res = await fetch(`${cfg.backendBaseUrl}/health`, {
            signal: AbortSignal.timeout(2500),
        });
        backend = (await res.json());
        backend.http_status = res.status;
    }
    catch (e) {
        backend = { status: "down", error: String(e) };
    }
    const backendOk = backend.status === "ok";
    const status = mcpOk && backendOk ? "ok" : "degraded";
    return c.json({
        status,
        runtime: "agent-runtime-ts",
        mcp_qptm: mcpOk,
        mcp_connected: qptmMcpConnected(),
        backend,
    });
});
app.get("/conversations", (c) => {
    const did = deviceId(c);
    if (!did)
        return c.json({ error: "X-Device-Id required" }, 401);
    return c.json({ conversations: listConversations(did) });
});
app.post("/conversations", async (c) => {
    const did = deviceId(c);
    if (!did)
        return c.json({ error: "X-Device-Id required" }, 401);
    const body = await c.req.json().catch(() => ({}));
    const title = body.title || "New conversation";
    const conv = createConversation(did, title);
    return c.json(conv);
});
app.get("/conversations/:id", (c) => {
    const did = deviceId(c);
    if (!did)
        return c.json({ error: "X-Device-Id required" }, 401);
    const conv = getConversation(c.req.param("id"), did);
    if (!conv)
        return c.json({ error: "Not found" }, 404);
    return c.json(conv);
});
app.delete("/conversations/:id", (c) => {
    const did = deviceId(c);
    if (!did)
        return c.json({ error: "X-Device-Id required" }, 401);
    const id = c.req.param("id");
    const ok = deleteConversation(id, did);
    if (!ok)
        return c.json({ error: "Not found" }, 404);
    resetSession(id);
    return c.json({ ok: true });
});
app.post("/conversations/:id/messages", async (c) => {
    const did = deviceId(c);
    if (!did)
        return c.json({ error: "X-Device-Id required" }, 401);
    const id = c.req.param("id");
    if (!belongsToDevice(id, did))
        return c.json({ error: "Not found" }, 403);
    const body = await c.req.json().catch(() => ({}));
    const { title, messages } = parseConversationMessagePost(body);
    if (title)
        updateTitle(id, title);
    for (const msg of messages) {
        addMessage(id, msg.role, msg.content, msg.meta);
    }
    return c.json({ ok: true, saved: messages.length });
});
app.post("/reset-session", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const sid = String(body.session_id || "").trim();
    const cid = String(body.conversation_id || "").trim();
    if (sid)
        resetSession(sid);
    if (cid) {
        resetSession(cid);
        clearConversationState(cid);
    }
    return c.json({ ok: true });
});
app.post("/classify", async (c) => {
    const body = await c.req.json();
    const message = String(body.message || "");
    const filenames = Array.isArray(body.upload_filenames)
        ? body.upload_filenames.map((n) => String(n))
        : [];
    const entities = parseEntities(message);
    const routeCollection = isCollectionRequest(message, entities, filenames);
    return c.json({
        mode: routeCollection ? "collection" : "chat",
        entities,
        route_collection: routeCollection,
        reply: null,
    });
});
app.post("/chat", async (c) => {
    const did = deviceId(c);
    if (!did)
        return c.json({ error: "X-Device-Id required" }, 401);
    const body = await c.req.json();
    const message = String(body.message || "");
    const mode = (body.mode === "deep_research" ? "deep_research" : "qa");
    const sessionId = body.session_id || newSessionId();
    let conversationId = body.conversation_id;
    const history = (body.history || []).map((h) => ({
        role: h.role,
        content: sanitizeUserVisibleText(h.content || ""),
    }));
    const clarificationResponse = body.clarification_response;
    const traceId = c.req.header("X-Trace-Id")?.trim() || randomUUID();
    let userMsg = message.trim();
    if (!userMsg && clarificationResponse) {
        userMsg = clarificationResponse.skip ? "(Skipped extra details; continue research)" : "(Clarification received)";
    }
    if (conversationId && !belongsToDevice(conversationId, did)) {
        return c.json({ error: "Conversation not found" }, 403);
    }
    let isNew = false;
    if (!conversationId) {
        const conv = createConversation(did, titleFromMessage(userMsg || "Research"));
        conversationId = conv.id;
        isNew = true;
    }
    if (userMsg)
        addMessage(conversationId, "user", userMsg);
    if (isNew && userMsg)
        updateTitle(conversationId, titleFromMessage(userMsg));
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            let fullAnswer = "";
            let followUps = [];
            const workflow = emptyWorkflowState();
            try {
                await runWithOpenCodeSession(sessionId, async () => {
                    for await (const event of runAgent({
                        message: message || userMsg,
                        sessionId,
                        conversationId,
                        history,
                        mode,
                        clarificationResponse,
                    })) {
                        applyAgentEvent(workflow, event);
                        const sse = agentEventToSse(event);
                        if (sse)
                            controller.enqueue(encoder.encode(sse));
                        if (event.type === "text")
                            fullAnswer += event.content || "";
                        if (event.type === "follow_up_questions")
                            followUps = event.questions || [];
                    }
                });
            }
            catch (e) {
                console.warn(`[${traceId}] chat error:`, e);
                const errSse = agentEventToSse({ type: "error", message: String(e) });
                if (errSse)
                    controller.enqueue(encoder.encode(errSse));
            }
            const snap = snapshotSession(sessionId, conversationId);
            if (snap && conversationId) {
                saveConversationState(conversationId, snap);
            }
            if (fullAnswer) {
                addMessage(conversationId, "assistant", sanitizeUserVisibleText(fullAnswer), {
                    follow_ups: followUps,
                    mode,
                    trace_id: traceId,
                    ...(workflowHasData(workflow) ? { workflow } : {}),
                });
            }
            controller.close();
        },
    });
    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Session-Id": sessionId,
            "X-Conversation-Id": conversationId,
            "X-Trace-Id": traceId,
        },
    });
});
export { app };
