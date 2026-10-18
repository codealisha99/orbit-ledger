import { Kafka, CompressionTypes } from "kafkajs";
import type { Trades } from "./binance";
const kafka = new Kafka({
  clientId: "orbitledger-ingest",
  brokers: process.env.KAFKA_BROKERS?.split(",") || ["localhost:9092"],
});
const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
export function startKafkaProducer() {
  return producer.connect();
}
export async function publishBatch(batch: Trades[]) {
  await producer.send({
    topic: "trades",
    acks: -1,
    compression: CompressionTypes.GZIP,
    messages: batch.map((t) => ({
      key: t.symbol,
      value: JSON.stringify(t),
      timestamp: String(t.timestamp),
    })),
  });
}
export function stopKafkaProducer() {
  return producer.disconnect();
}
