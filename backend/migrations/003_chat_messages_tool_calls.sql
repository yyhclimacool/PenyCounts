-- Persist the full AI tool-call chain in chat history.
--
-- The AI agent replays prior chat_messages as context. Previously only
-- role='user'/'assistant' text was stored, so the model never saw that
-- recording/querying requires calling a tool — weak models learned to just
-- emit a confirmation sentence and skip the tool call entirely.
--
-- Allow a 'tool' role and store the OpenAI tool-call payload so history can be
-- reconstructed faithfully as: user -> assistant(tool_calls) -> tool -> assistant.

ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_role_check;
ALTER TABLE chat_messages
    ADD CONSTRAINT chat_messages_role_check
    CHECK (role IN ('user', 'assistant', 'tool'));

-- Serialized OpenAI `tool_calls` array (assistant turns that invoked tools).
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS tool_calls TEXT;
-- Links a tool result row back to the assistant tool call it answers.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS tool_call_id TEXT;
