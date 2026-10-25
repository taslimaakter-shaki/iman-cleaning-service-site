const assert = require("assert");
const { buildManualCallRow, buildRetellCallRow, buildTranscriptionRow, callbackRequestedFromText } = require("../api/receptionist/_shared");
const { isCallbackRecord, toClientCallback } = require("../api/crm/_callbacks");
const { toClientCall } = require("../api/crm/_calls");

(() => {
  assert.equal(callbackRequestedFromText("All of our representatives are busy right now. We will call you back as soon as possible."), true);
  assert.equal(callbackRequestedFromText("Your call was transferred successfully."), false);

  const manual = buildManualCallRow({
    callId: "call-callback-1",
    callerName: "Test Customer",
    callerPhone: "+19295550123",
    reason: "Speak to a representative"
  }, { transferRequested: true, callbackRequested: true });
  assert.equal(manual.transfer_requested, true);
  assert.equal(manual.metadata.iman_callback.status, "Pending");
  assert.equal(isCallbackRecord(manual), true);

  const transcription = buildTranscriptionRow({
    type: "post_call_transcription",
    event_timestamp: 1788861600,
    data: {
      conversation_id: "call-callback-2",
      status: "done",
      transcript: [
        { role: "agent", message: "I will transfer you now.", tool_calls: [{ name: "transfer_to_number" }] },
        { role: "agent", message: "All of our representatives are busy right now. We will call you back as soon as possible." }
      ],
      analysis: { transcript_summary: "Customer requested an agent, but the team was busy." },
      metadata: { phone_call: { From: "+19295550124" } }
    }
  });
  assert.equal(transcription.metadata.iman_callback.status, "Pending");
  assert.equal(isCallbackRecord(transcription), true);
  assert.equal(toClientCallback(transcription).phone, "+19295550124");
  const call = toClientCall(transcription);
  assert.equal(call.id, "call-callback-2");
  assert.match(call.transcript, /representatives are busy/);

  const retell = buildRetellCallRow({
    event: "call_analyzed",
    call: {
      call_id: "retell-123",
      agent_id: "agent-123",
      from_number: "+13475550123",
      to_number: "+19292321930",
      direction: "inbound",
      call_status: "ended",
      start_timestamp: 1788861600000,
      duration_ms: 90500,
      transcript: "Agent: How may I help?\nUser: I need a deep cleaning quote.",
      transcript_object: [{ role: "agent", content: "How may I help?" }],
      recording_url: "https://example.test/call.mp3",
      retell_llm_dynamic_variables: { customer_name: "Retell Caller" },
      call_analysis: { call_summary: "Caller requested a deep cleaning quote." }
    }
  });
  assert.equal(retell.conversation_id, "retell-123");
  assert.equal(retell.customer_name, "Retell Caller");
  assert.equal(retell.call_duration_seconds, 91);
  assert.match(retell.transcript_text, /deep cleaning quote/i);
  assert.equal(retell.audio_file_link, "https://example.test/call.mp3");

  const successful = { ...manual, metadata: {}, call_status: "completed", summary: "Transferred successfully." };
  assert.equal(isCallbackRecord(successful), false);
  console.log("CRM callback tests passed.");
})();
