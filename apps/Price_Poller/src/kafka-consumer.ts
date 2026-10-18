import { Kafka, logLevel } from "kafkajs";
import { writeBatch } from "./database";
import type { Trades } from "./binance";


let batch: Trades[] = [];
let batchTimer: NodeJS.Timeout | null = null; // in node.js setimeout() return an  NodeJS.Timeout object  and browser return an number
let isShuttingDown = false;
let isConnected = false; // Track connection state

const kafka = new Kafka({
  clientId: "exness_cfd_consumer",
  brokers: process.env.KAFKA_BROKERS?.split(",") || ["localhost:9092"],
  logLevel: logLevel.NOTHING, // Suppress all Kafka logs - we handle errors in catch blocks
  connectionTimeout: 10000, // 10 seconds
  requestTimeout: 30000, // 30 seconds
  retry: {
    initialRetryTime: 300,
    retries: 10,
    maxRetryTime: 30000,
    multiplier: 2,
    restartOnFailure: async (e: any) => {
      return e.retriable === true;
    },
  },
});

const consumer = kafka.consumer({
  groupId: "exness_consumer_group",
  sessionTimeout: 60000, // Increased to 60s
  heartbeatInterval: 3000, // Explicitly set to 3s
  maxWaitTimeInMs: 5000, // Max wait time for fetch requests
  retry: {
    initialRetryTime: 100,
    retries: 8,
  },
}); //connect kafka consumer

async function flushBatch() {
  if (batch.length === 0) return; //no trades in batch then do nothing.
  const currentBatch = [...batch];
  batch = [];

  try {
    await writeBatch(currentBatch);
    console.log(` Flushed ${currentBatch.length} trades to database`);
  } catch (error) {
    console.error(" Database write failed:", error);
  }
}

function resetBatchTimer() {
  if (batchTimer) {
    clearTimeout(batchTimer); // Clear existing setTimeout timer
  }

  batchTimer = setTimeout(async () => {
    console.log("Batch timeout 5 sec, flushing...");
    await flushBatch();
  }, 5000);
}

export async function consumer_gr() {
  if (isShuttingDown || isConnected) return;

  await new Promise(resolve => setTimeout(resolve, 6000));

  try {
    console.log("Connecting to Kafka consumer...");
    await consumer.connect();
    isConnected = true;
    console.log("✓ Kafka Consumer connected successfully");

    await consumer.subscribe({
      topic: "trades",
      fromBeginning: false,
    });
    console.log(" Subscribed to 'trades' topic");

    await consumer.run({
      eachMessage: async ({ message }) => {
        try {
          const data = JSON.parse(message.value?.toString() ?? "{}");
          batch.push(data);

          if (batch.length >= 500) {
            console.log(`Batch size reached (${batch.length}), flushing...`);
            await flushBatch();

            if (batchTimer) {
              clearTimeout(batchTimer);
            }
            resetBatchTimer();
          } else {
            resetBatchTimer();
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`Error processing message: ${errorMessage}`);
        }
      },
    });
  } catch (err) {
    isConnected = false;
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`✗ Kafka consumer connection failed: ${errorMessage}`);
    console.log("Retrying in 5 seconds...");

    try {
      if (consumer) {
        await consumer.disconnect();
      }
    } catch (disconnectErr) {
    }

    if (!isShuttingDown) {
      setTimeout(() => {
        consumer_gr();
      }, 5000);
    }
  }
}
export async function shutdownConsumer() {
  if (isShuttingDown) return;

  isShuttingDown = true;
  console.log("Shutting down Kafka consumer...");

  try {
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
      console.log("✓ Batch timer stopped");
    }

    if (batch.length > 0) {
      console.log(`  Flushing ${batch.length} remaining trades to database...`);
      await writeBatch(batch);
      batch = [];
      console.log("✓ Batch flushed successfully");
    }

    if (isConnected && consumer) {
      await consumer.disconnect();
      isConnected = false;
      console.log("✓ Kafka consumer disconnected successfully");
    }
  } catch (error) {
    console.error("✗ Error during Kafka consumer shutdown:", error);
  }
}
