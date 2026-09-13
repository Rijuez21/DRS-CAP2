import mqtt from "mqtt";
import "dotenv/config";
import { ingestLocation } from "./locationService.js";

/**
 * The paper (Table 11, "IoT and GPS Integration") frames MQTT as
 * "considered" / "evaluated" rather than committed to — the primary GPS
 * path is the driver's phone posting to the REST API (2.5.2, "drivers'
 * existing Android smartphones running the dedicated web application").
 *
 * This listener exists so the MQTT option is real and usable if you later
 * put a lightweight telemetry device on a bus (rather than relying on the
 * phone), without touching the REST path at all — both feed the same
 * ingestLocation() pipeline (MySQL + Redis + Socket.io).
 *
 * It only starts if MQTT_BROKER_URL is set; otherwise it's a no-op, since
 * the document never commits to MQTT as the shipped mechanism.
 *
 * Expected topic: drs/bus/<busId>/location
 * Expected payload (JSON): { "latitude": 16.41, "longitude": 120.59, "timestamp": "2026-09-05T08:00:00Z", "syncStatus": "buffered" }
 */
export function startMqttListener(io) {
  const brokerUrl = process.env.MQTT_BROKER_URL;
  if (!brokerUrl) {
    console.log("MQTT_BROKER_URL not set — skipping MQTT listener (REST /api/tracking is the live GPS path).");
    return null;
  }

  const topic = process.env.MQTT_TOPIC || "drs/bus/+/location";
  const client = mqtt.connect(brokerUrl);

  client.on("connect", () => {
    console.log(`MQTT connected to ${brokerUrl}, subscribing to ${topic}`);
    client.subscribe(topic);
  });

  client.on("message", async (receivedTopic, payloadBuffer) => {
    try {
      const busId = receivedTopic.split("/")[2]; // drs/bus/<busId>/location
      const payload = JSON.parse(payloadBuffer.toString());
      await ingestLocation(io, {
        busId,
        latitude: payload.latitude,
        longitude: payload.longitude,
        timestamp: payload.timestamp,
        syncStatus: payload.syncStatus ?? "synced",
      });
    } catch (err) {
      console.error("Failed to process MQTT message:", err.message);
    }
  });

  client.on("error", (err) => console.error("MQTT client error:", err.message));

  return client;
}
