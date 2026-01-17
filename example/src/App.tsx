import "./App.css";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useState } from "react";

function DebouncerDemo() {
  const [propertyId, setPropertyId] = useState("property-1");
  const [price, setPrice] = useState("500000");
  const [conversationId, setConversationId] = useState("conv-1");
  const [message, setMessage] = useState("");
  const [log, setLog] = useState<string[]>([]);

  const onPropertyUpdate = useMutation(api.example.onPropertyUpdate);
  const onUserMessage = useMutation(api.example.onUserMessage);
  const queueForBatch = useMutation(api.example.queueForBatchProcessing);
  const getStatus = useQuery(api.example.getDebounceStatus, {
    namespace: "property-metrics",
    key: propertyId,
  });
  const cancelDebounce = useMutation(api.example.cancelDebounce);

  const addLog = (msg: string) => {
    setLog((prev) => [...prev.slice(-9), `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  const handlePropertyUpdate = async () => {
    const result = await onPropertyUpdate({
      propertyId,
      newData: { price: parseInt(price) },
    });
    addLog(
      `Property update scheduled (executed: ${result.executed}, scheduledFor: ${new Date(result.scheduledFor).toLocaleTimeString()})`,
    );
  };

  const handleMessage = async () => {
    if (!message.trim()) return;
    const result = await onUserMessage({
      conversationId,
      message: message,
    });
    addLog(
      `Message sent (immediate: ${result.executed}, trailing at: ${new Date(result.scheduledFor).toLocaleTimeString()})`,
    );
    setMessage("");
  };

  const handleBatch = async () => {
    const result = await queueForBatch({
      batchId: "batch-1",
      itemId: `item-${Date.now()}`,
    });
    addLog(`Batch item queued (fixed timer at: ${new Date(result.scheduledFor).toLocaleTimeString()})`);
  };

  const handleCancel = async () => {
    const cancelled = await cancelDebounce({
      namespace: "property-metrics",
      key: propertyId,
    });
    addLog(`Cancel result: ${cancelled ? "cancelled" : "nothing to cancel"}`);
  };

  return (
    <div style={{ textAlign: "left" }}>
      <h2>Debouncer Demo</h2>

      <section style={{ marginBottom: "2rem", padding: "1rem", border: "1px solid #333", borderRadius: "8px" }}>
        <h3>Sliding Mode - Property Metrics</h3>
        <p style={{ fontSize: "0.9rem", color: "#888" }}>
          Each update resets the 5-second timer. Rapid updates delay the computation.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <input
            type="text"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            placeholder="Property ID"
            style={{ padding: "0.5rem" }}
          />
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price"
            style={{ padding: "0.5rem", width: "120px" }}
          />
          <button onClick={handlePropertyUpdate}>Update Property</button>
          <button onClick={handleCancel} style={{ backgroundColor: "#dc3545" }}>
            Cancel
          </button>
        </div>
        {getStatus && (
          <div style={{ fontSize: "0.85rem", color: "#0f0" }}>
            Status: pending={String(getStatus.pending)}, retriggers={getStatus.retriggerCount},
            scheduled={new Date(getStatus.scheduledFor).toLocaleTimeString()}
          </div>
        )}
      </section>

      <section style={{ marginBottom: "2rem", padding: "1rem", border: "1px solid #333", borderRadius: "8px" }}>
        <h3>Eager Mode - AI Responses</h3>
        <p style={{ fontSize: "0.9rem", color: "#888" }}>
          First message executes immediately. Subsequent messages queue trailing execution.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <input
            type="text"
            value={conversationId}
            onChange={(e) => setConversationId(e.target.value)}
            placeholder="Conversation ID"
            style={{ padding: "0.5rem" }}
          />
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Message"
            style={{ padding: "0.5rem", flex: 1 }}
            onKeyPress={(e) => e.key === "Enter" && handleMessage()}
          />
          <button onClick={handleMessage}>Send</button>
        </div>
      </section>

      <section style={{ marginBottom: "2rem", padding: "1rem", border: "1px solid #333", borderRadius: "8px" }}>
        <h3>Fixed Mode - Batch Processing</h3>
        <p style={{ fontSize: "0.9rem", color: "#888" }}>
          Timer stays fixed from first item. More items don't extend the timer.
        </p>
        <button onClick={handleBatch}>Add Batch Item</button>
      </section>

      <section style={{ padding: "1rem", backgroundColor: "#111", borderRadius: "8px" }}>
        <h4 style={{ margin: "0 0 0.5rem 0" }}>Activity Log</h4>
        <div style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
          {log.length === 0 && <div style={{ color: "#666" }}>No activity yet...</div>}
          {log.map((entry, i) => (
            <div key={i}>{entry}</div>
          ))}
        </div>
      </section>
    </div>
  );
}

function App() {
  return (
    <>
      <h1>Convex Debouncer Example</h1>
      <div className="card">
        <DebouncerDemo />
        <p style={{ marginTop: "2rem" }}>
          See <code>example/convex/example.ts</code> for the implementation
        </p>
      </div>
    </>
  );
}

export default App;
