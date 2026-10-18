import { Kafka } from "kafkajs";
import { writeBatch } from "./database";
import type { Trades } from "./binance";
const kafka = new Kafka({
  clientId: "orbitledger-writer",
  brokers: process.env.KAFKA_BROKERS?.split(",") || ["localhost:9092"],
});
const consumer = kafka.consumer({
  groupId: "orbitledger-durable-writer",
  sessionTimeout: 60000,
});
export async function consumer_gr() {
  await consumer.connect();
  await consumer.subscribe({ topic: "trades", fromBeginning: true });
  await consumer.run({
    autoCommit: false,
    eachBatchAutoResolve: false,
    eachBatch: async ({
      batch,
      resolveOffset,
      heartbeat,
      isRunning,
      isStale,
    }) => {
      for (let i = 0; i < batch.messages.length; i += 500) {
        if (!isRunning() || isStale()) return;
        const messages = batch.messages.slice(i, i + 500);
        const trades = messages.map(
          (m) => JSON.parse(m.value!.toString()) as Trades,
        );
        await writeBatch(trades);
        for (const m of messages) resolveOffset(m.offset);
        await consumer.commitOffsets([
          {
            topic: batch.topic,
            partition: batch.partition,
            offset: (BigInt(messages.at(-1)!.offset) + 1n).toString(),
          },
        ]);
        await heartbeat();
      }
    },
  });
}
export async function shutdownConsumer() {
  await consumer.stop();
  await consumer.disconnect();
}
