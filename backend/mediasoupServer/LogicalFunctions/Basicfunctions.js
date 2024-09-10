const mediasoup = require("mediasoup");
const os = require("os");
require("dotenv").config();

const RTC_MIN_PORT = 2000;
const RTC_MAX_PORT = 3000;
// const ANNOUNCED_IP = "127.0.0.1";
const ANNOUNCED_IP = "65.1.55.237";

async function createWorker() {
  try {
    const numCores = os.cpus().length;

    const worker = await mediasoup.createWorker({
      logLevel: "debug",
      logTags: ["rtp", "srtp", "rtcp"],
      rtcMinPort: RTC_MIN_PORT,
      rtcMaxPort: RTC_MAX_PORT,
    });

    console.log(`worker pid ${worker.pid}`);

    worker.on("died", (error) => {
      console.error("mediasoup worker has died", error);
      setTimeout(() => process.exit(1), 2000);
    });

    return worker;
  } catch (error) {
    console.error("Error creating worker:", error);
    throw error;
  }
}

async function createWebRtcTransport(router) {
  const webRtcTransportOptions = {
    listenIps: [
      {
        ip: "0.0.0.0",
        announcedIp: ANNOUNCED_IP,
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  };

  try {
    const transport = await router.createWebRtcTransport(
      webRtcTransportOptions
    );
    console.log(`transport id: ${transport.id}`);

    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") {
        transport.close();
      }
    });

    transport.on("close", () => {
      console.log("transport closed");
    });

    return transport;
  } catch (error) {
    console.error("Error creating WebRTC transport:", error);
    throw error;
  }
}

async function pipeProducersBetweenRouters({
  producerIds,
  sourceRouter,
  targetRouter,
  alreadyPipedProducersforcheck,
}) {
  if (sourceRouter === targetRouter) {
    return;
  }

  try {
    if (!alreadyPipedProducersforcheck.has(producerIds)) {
      alreadyPipedProducersforcheck.add(producerIds);

      console.log(producerIds, "producerId");

      if (producerIds == undefined) {
        return;
      }

      const { pipeConsumer, pipeProducer } = await sourceRouter.pipeToRouter({
        producerId: producerIds,
        router: targetRouter,
      });

      console.log(
        `Successfully piped producer ${producerIds} to target router`
      );
      console.log("ID of consumer", pipeConsumer.id);

      pipeConsumer.on("transportclose", () => {
        console.log(`Consumer for producer ${producerIds} closed`);
        pipeConsumer.close();
      });

      pipeProducer.on("producerclose", () => {
        console.log(`Producer ${producerIds} closed`);
        pipeProducer.close();
      });

      pipeProducer.on("transportclose", () => {
        console.log(`Producer ${producerIds} closed`);
        pipeProducer.close();
      });

      return { pipeConsumerId: pipeConsumer.id, pipeProducer };
    }
  } catch (error) {
    console.error(`Error piping producer ${producerIds}: ${error.message}`);
    alreadyPipedProducersforcheck.delete(producerIds);
  }
}

module.exports = {
  createWorker,
  createWebRtcTransport,
  pipeProducersBetweenRouters,
};
