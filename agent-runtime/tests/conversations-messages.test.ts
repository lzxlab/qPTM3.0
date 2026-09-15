import assert from "node:assert/strict";
import { parseConversationMessagePost } from "../src/storage/conversation-messages.js";

const batch = parseConversationMessagePost({
  title: "Collect PMID 39732660",
  messages: [
    { role: "user", content: "Collect quantitative PTM data from PMID 39732660" },
    {
      role: "assistant",
      content: "Stage 1 complete.",
      meta: { collection: { job_id: "job-1", pmid: "39732660" } },
    },
  ],
});
assert.equal(batch.title, "Collect PMID 39732660");
assert.equal(batch.messages.length, 2);
assert.equal(batch.messages[0].role, "user");
assert.equal(batch.messages[1].meta?.collection?.job_id, "job-1");

const flat = parseConversationMessagePost({
  role: "assistant",
  content: "Done",
  meta: { collection: { job_id: "job-2" } },
});
assert.equal(flat.title, "");
assert.equal(flat.messages.length, 1);
assert.equal(flat.messages[0].content, "Done");

const emptyLegacy = parseConversationMessagePost({
  messages: [{ role: "assistant", content: "Stage 1 complete.", meta: { collection: {} } }],
});
assert.equal(emptyLegacy.messages.length, 1);

const blankUserBubble = parseConversationMessagePost({});
assert.equal(blankUserBubble.messages.length, 0);

const blankBatch = parseConversationMessagePost({
  messages: [{ role: "user", content: "" }],
});
assert.equal(blankBatch.messages.length, 0);

console.log("conversations-messages tests passed");
