process.env.DEBUG = "mediasoup*";
const mediasoup = require("mediasoup");
const { AwaitQueue } = require("awaitqueue");
const os = require("os");
const promClient = require("prom-client");
const pidusage = require("pidusage");
const {
  createWorker,
  createWebRtcTransport,
  pipeProducersBetweenRouters,
} = require("./LogicalFunctions/Basicfunctions");

const {
  // RoomQueue
  getRoomQueue,
  pushToRoomQueue,
  deleteFromRoomQueue,
  // Workermap
  getWorkermap,
  addToWorkermap,
  deleteFromWorkermap,
  // Rooms
  getRooms,
  addToRooms,
  deleteFromRooms,
  // Peers
  getPeers,
  addToPeers,
  deleteFromPeers,
} = require("./utils/states");

const { setRedisData } = require("./utils/redis");

const SERVER_ID = `mediasoup_server_${process.pid}`;

module.exports = async function (io) {
  let workermap = new Map();
  let transports = new Map(); // [ { socketId1, roomName1, transport, consumer }, ... ]
  let producers = []; // [ { socketId1, roomName1, producer, }, ... ]
  let consumers = []; // [ { socketId1, roomName1, consumer, }, ... ]
  let Peerstrack = [];
  let alreadyPipedProducersforcheck = new Set();
  let alreadyPipedProducer = new Set();
  let Roomfull = false;
  let Currentindex = 0;
  let Remoteindex = 0;
  const participantRouterMap = new Map();
  const producerRouterMap = new Map();
  let Trakpiped = new Map();

  const mediaCodecs = [
    {
      kind: "audio",
      mimeType: "audio/opus",
      clockRate: 48000,
      channels: 2,
    },
    {
      kind: "video",
      mimeType: "video/VP8",
      clockRate: 90000,
      parameters: {
        "x-google-start-bitrate": 1000,
      },
    },
  ];

  // Initialize Prometheus metrics
  const metrics = {
    cpuUsage: new promClient.Gauge({
      name: "mediasoup_worker_cpu_usage",
      help: "CPU usage of mediasoup workers",
      labelNames: ["worker_id"],
    }),
    memoryUsage: new promClient.Gauge({
      name: "mediasoup_worker_memory_usage",
      help: "Memory usage of mediasoup workers in MB",
      labelNames: ["worker_id"],
    }),
    transportBandwidth: new promClient.Gauge({
      name: "mediasoup_transport_bandwidth",
      help: "Bandwidth usage of WebRTC transports in MB",
      labelNames: ["transport_id", "direction"],
    }),
    activeUsers: new promClient.Gauge({
      name: "mediasoup_active_users",
      help: "Number of active users in the system",
    }),
  };

  setInterval(async () => {
    try {
      // CPU and Memory Usage Monitoring
      for (const [workerIndex, workerData] of workermap.entries) {
        const { worker } = workerData;

        try {
          const usage = await pidusage(worker.pid);

          // Update Prometheus metrics for CPU and Memory usage
          metrics.cpuUsage.labels(worker.pid).set(usage.cpu);
          metrics.memoryUsage
            .labels(worker.pid)
            .set(usage.memory / 1024 / 1024); // Convert to MB

          console.log(
            `Worker ${workerIndex} - PID: ${worker.pid}, CPU: ${
              usage.cpu
            }%, Memory: ${usage.memory / 1024 / 1024} MB`
          );
        } catch (usageError) {
          console.error(
            `Failed to get usage for worker ${workerIndex}:`,
            usageError.message
          );
        }
      }

      // Transport Bandwidth Monitoring
      for (const [transportId, transportData] of transports.entries()) {
        const { transport } = transportData;

        if (transport && !transport.closed) {
          try {
            const stats = await transport.getStats();

            stats.forEach((stat) => {
              const bytesSent = stat.bytesSent / 1024 / 1024; // Convert to MB
              const bytesReceived = stat.bytesReceived / 1024 / 1024; // Convert to MB

              // Update Prometheus metrics for transport bandwidth
              metrics.transportBandwidth
                .labels(transportId, "sent")
                .set(bytesSent);
              metrics.transportBandwidth
                .labels(transportId, "received")
                .set(bytesReceived);

              console.log(
                `Transport ${transportId} - Bandwidth: ${bytesSent} MB sent, ${bytesReceived} MB received`
              );
            });
          } catch (statsError) {
            console.error(
              `Failed to get stats for transport ${transportId}:`,
              statsError.message
            );
          }
        }
      }

      // Update active users metric (peers map size)
      const parsedPeers = await getPeers();
      peers = new Map(Object.entries(parsedPeers));
      metrics.activeUsers.set(peers.size);
    } catch (error) {
      console.error("Error in resource monitoring:", error.message);
    }
  }, 5000); // Runs every 5 seconds

  // Worker creation and storing worker data in Redis
  async function createWorkers() {
    const numCores = os.cpus().length;

    for (let i = 0; i < numCores; i++) {
      const worker = await mediasoup.createWorker({
        logLevel: "debug",
        logTags: ["rtp", "srtp", "rtcp"],
        rtcMinPort: 20000 + i * 100,
        rtcMaxPort: 20100 + i * 100,
      });

      worker.on("died", async () => {
        console.error(`mediasoup worker ${worker.pid} has died`);
        setTimeout(() => process.exit(1), 2000);
      });

      const router = await worker.createRouter({ mediaCodecs });

      workermap.set(i, { worker, router });

      // Initialize worker load
      await setRedisData(`${SERVER_ID}:workerLoad:${worker.pid}`, 0);

      ChangeRouterindex(0);

      console.log(
        `Worker created with PID: ${worker.pid}, and its router initialized.`
      );
    }
  }

  await createWorkers();

  function ChangeRouterindex(index) {
    Currentindex = index;
    return Currentindex;
  }

  function FetchCurrentindex() {
    return Currentindex;
  }

  async function createRoom(roomName, socketId, i) {
    try {
      const parsedRooms = await getRooms();

      // Ensure parsedRooms is an object
      const rooms = parsedRooms
        ? new Map(Object.entries(parsedRooms))
        : new Map();

      let room = rooms.get(roomName);

      if (!room) {
        const router = await workermap.get(i).router;
        room = { router, peers: new Set([socketId]) };
        await addToRooms(roomName, room);
      } else {
        room.peers.add(socketId);
        await addToRooms(roomName, room);
      }

      console.log(`This is Room Router ${room.router}`, rooms);

      return room.router;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  function getSourceRouterForProducer(producerId) {
    const routerIndex = producerRouterMap.get(producerId);
    if (routerIndex !== undefined) {
      return workermap.get(routerIndex).router;
    } else {
      console.error("Producer not associated with any router.");
      return null;
    }
  }

  async function pipeExistingProducersToTargetRouter(socket) {
    console.log("pipeExistingProducersToTargetRouter");
    const parsedPeers = await getPeers();
    const peers = new Map(Object.entries(parsedPeers));

    for (let producerData of producers) {
      if (!producerData.producer.id) continue;
      const sourceRouterindex = producerRouterMap.get(producerData.producer.id);
      const sourceRouter = workermap.get(sourceRouterindex).router;
      console.log("pipetoall ", sourceRouter);

      if (alreadyPipedProducersforcheck.has(producerData.producer.id)) {
        return;
      }

      if (!sourceRouter) continue;

      let targetRouter;
      if (Currentindex === 1) {
        targetRouter = workermap.get(0).router;
      } else {
        targetRouter = workermap.get(1).router;
      }
      console.log("Insideia ", targetRouter);

      const producerSocket = peers.get(producerData.socketId).socketId;

      if (targetRouter === sourceRouter) continue;

      if (alreadyPipedProducersforcheck.has(producerData.producer.id)) {
        console.log("this is already piped");
        continue;
      }

      // Check if the producer is not already piped to this target router
      if (!alreadyPipedProducersforcheck.has(producerData.producer.id)) {
        const { pipeConsumer, pipeProducer } =
          await pipeProducersBetweenRouters({
            producerIds: producerData.producer.id,
            sourceRouter,
            targetRouter,
            alreadyPipedProducersforcheck,
          });
        console.log(pipeProducer);

        if (!pipeProducer || !pipeConsumer) continue;

        // Emit the new producer piped event to the socket
        await socket.emit("new-producer-piped", {
          producerId: pipeConsumer,
          targetRouterindex: Currentindex,
        });

        // Update Trakpiped and alreadyPipedProducer in Redis
        await addToTrakpiped(pipeConsumer, targetRouter);
        await addToAlreadyPipedProducer(pipeConsumer);
      }
    }
  }

  // Now, pipe the new participant's producer to all other routers

  const getTransport = (socketId) => {
    for (let [transportId, transportData] of transports.entries()) {
      if (transportData.socketId === socketId && !transportData.consumer) {
        return transportData.transport;
      }
    }
    console.error(`Transport not found for socket ID: ${socketId}`);
    return null;
  };

  const informConsumers = async (roomName, socketId, id, socket) => {
    console.log(`just joined, id ${id} ${roomName}, ${socketId}`);

    // Fetch peers from Redis
    const parsedPeers = await getPeers();
    const peers = new Map(Object.entries(parsedPeers));

    producers.forEach((producerData) => {
      if (
        producerData.socketId !== socketId &&
        producerData.roomName === roomName
      ) {
        if (peers.has(producerData.socketId)) {
          const producerSocket = peers.get(producerData.socketId).socketId;
          console.log("Inform", producerData.producer.id, id);

          // Emit the 'new-producer' event to all clients in the room
          socket.broadcast.to(roomName).emit("new-producer", {
            producerId: id,
            targetRouterindex: 0,
          });

          // Pipe the producer
          pipeProducer(id, producerSocket, socket);
        } else {
          console.log(`Producer not found in peers: ${producerData.socketId}`);
        }
      }
    });
  };

  const pipeProducer = async (producerId, producerSocket, socket) => {
    if (alreadyPipedProducersforcheck.has(producerId)) return;

    try {
      let targetRouterIndex;

      if (Currentindex === 1) {
        const sourceRouterIndex = producerRouterMap.get(producerId);

        const sourceRouter = workermap.get(sourceRouterIndex)?.router;

        const targetRouter = workermap.get(0)?.router; // Target router is always from worker 0 (or adjust if needed)

        // Check if sourceRouter or targetRouter is undefined
        if (!sourceRouter || !targetRouter) {
          console.error("Source or target router not found in workermap");
          return;
        }

        if (sourceRouter === targetRouter) return;
        if (!alreadyPipedProducersforcheck.has(producerId)) {
          const { pipeConsumer, pipeProducer } =
            await pipeProducersBetweenRouters({
              producerIds: producerId,
              sourceRouter,
              targetRouter,
              alreadyPipedProducersforcheck,
              producerSocket,
            });

          await pipeProducer.on("transportclose", () => {
            console.log("transport for this producer closed ");
            pipeProducer.close();
          });

          if (pipeConsumer === null || pipeConsumer === undefined) {
            return;
          }
          console.log("event is being triggered", pipeConsumer);

          await producerSocket.emit("new-producer-piped", {
            producerId: pipeConsumer.id,
            targetRouterindex: Currentindex,
          });
          Trakpiped.set(pipeConsumer, targetRouter);

          alreadyPipedProducer.add(pipeConsumer.id);

          // Save updated state to Redis
          await addToTrakpiped(pipeConsumer.id, targetRouter);
          await addToAlreadyPipedProducer(pipeConsumer.id);
        }
        return;
      } else {
        targetRouterIndex = 1;
      }

      console.log("in pipeProducer", producerId);
      const sourceRouterIndex = producerRouterMap.get(producerId);
      if (sourceRouterIndex === undefined) {
        console.error(`Producer ${producerId} not associated with any router.`);
        return;
      }
      if (sourceRouterIndex === targetRouterIndex) {
        console.log(`Producer ${producerId} already in the target router.`);
        return;
      }
      const sourceRouter = workermap.get(sourceRouterIndex).router;
      const targetRouter = workermap.get(targetRouterIndex).router;

      const { pipeConsumer, pipeProducer } = await pipeProducersBetweenRouters({
        producerIds: producerId,
        sourceRouter,
        targetRouter,
        alreadyPipedProducersforcheck,
        producerSocket,
      });

      await pipeProducer.on("transportclose", () => {
        console.log("transport for this producer closed ");
        pipeProducer.close();
      });

      if (pipeConsumer === null || pipeConsumer === undefined) {
        return;
      }
      console.log("event is being triggered", pipeConsumer);

      await producerSocket.emit("new-producer-piped", {
        producerId: pipeConsumer.id,
        targetRouterindex: Currentindex,
      });
      Trakpiped.set(pipeConsumer, targetRouter);

      alreadyPipedProducer.add(pipeConsumer.id);

      Roomfull = true;

      // Save updated state to Redis
      await addToTrakpiped(pipeConsumer.id, targetRouter);
      await addToAlreadyPipedProducer(pipeConsumer.id);
    } catch (error) {
      console.error("Error in processing:", error.message);
      Roomfull = false;
    }
  };

  io.on("connection", (socket) => {
    console.log(`peer joined ${socket.id}`);
    socket.emit("connection-success", { socketID: socket.id });

    const removeItems = (items, socketId, type) => {
      if (!Array.isArray(items)) {
        console.error("items is not an array");
        return items;
      }

      items.forEach((item) => {
        if (item.socketId === socket.id) {
          item[type].close();
        }
      });

      items = items.filter((item) => item.socketId !== socket.id);

      return items;
    };

    const addTransport = async (transport, roomName, consumer) => {
      // Retrieve peers from Redis
      const parsedPeers = await getPeers();
      const peers = new Map(Object.entries(parsedPeers));

      // Get the peer associated with the socket ID
      let peer = peers[socket.id];

      if (peer) {
        // Update peer's transports array in memory
        if (!peer.transports) peer.transports = [];
        peer.transports.push(transport.id);

        // Save updated peer to Redis
        await addToPeers(socket.id, peer);

        // Save transport locally
        transports.set(transport.id, {
          socketId: socket.id,
          transport,
          roomName,
          consumer,
        });
      } else {
        console.log(`Peer with socket ID ${socket.id} not found in Redis.`);
      }
    };

    const addProducer = async (producer, roomName, kind) => {
      if (producers.some((p) => p.producer.id === producer.id)) {
        console.warn(`Producer ${producer.id} already exists.`);
        return;
      }

      producers = [
        ...producers,
        { socketId: socket.id, producer, roomName, kind },
      ];
      console.log(producer.id);

      // Fetch peer from Redis
      const parsedPeers = await getPeers();
      const peers = new Map(Object.entries(parsedPeers));

      let peer = peers.get(socket.id);

      if (!peer) {
        console.error(`Peer with socket ID ${socket.id} not found in Redis.`);
        return;
      }

      // Ensure the producers array exists for the peer
      if (!peer.producers) peer.producers = [];

      // Add producer id to the peer's producers array
      peer.producers.push(producer.id);

      // Update the peer's data in Redis
      await addToPeers(socket.id, peer);
    };

    const addConsumer = async (consumer, roomName) => {
      if (consumers.some((c) => c.consumer.id === consumer.id)) {
        console.warn(`Consumer ${consumer.id} already exists.`);
        return;
      }

      consumers = [...consumers, { socketId: socket.id, consumer, roomName }];

      // Fetch peer from Redis
      const parsedPeers = await getPeers();
      const peers = new Map(Object.entries(parsedPeers));

      let peer = peers.get(socket.id);

      if (!peer) {
        console.error(`Peer with socket ID ${socket.id} not found in Redis.`);
        return;
      }

      // Ensure the consumers array exists for the peer
      if (!peer.consumers) peer.consumers = [];

      // Add consumer id to the peer's consumers array
      peer.consumers.push(consumer.id);

      // Update the peer's data in Redis
      await addToPeers(socket.id, peer);
    };

    socket.on("joinRoom", async ({ roomName }, callback) => {
      console.log("joinRoom");
      const parsedPeers = await getPeers();
      const peers = new Map(Object.entries(parsedPeers));

      if (peers.has(socket.id)) {
        console.warn(`Socket ${socket.id} is already in a room.`);
        return callback({ error: "You are already in a room." });
      }

      let router1;
      let router2;
      let rtpCapabilities;

      console.log("Status of room", Roomfull);
      router1 = await createRoom(roomName, socket.id, 0);
      router2 = await createRoom(roomName, socket.id, 1);

      const Routers = [router1.rtpCapabilities, router2.rtpCapabilities];
      participantRouterMap.set(socket.id, Currentindex);

      if (Remoteindex > 10) {
        ChangeRouterindex(1);
      }

      let peerData = {
        sockerId: socket.id,
        roomName,
        transports: [],
        producers: [],
        consumers: [],
        peerDetails: {
          name: "",
          isAdmin: false,
        },
      };

      await addToPeers(socket.id, peerData);

      socket.roomName = roomName; // Add room name to the socket
      socket.join(roomName); // Join the socket to the room
      let rpa = router1.rtpCapabilities;
      Remoteindex += 1;
      const producerStates = producers
        .filter((producerData) => producerData.roomName === roomName)
        .map((producerData) => ({
          producerId: producerData.producer.id,
          isPaused: producerData.producer.paused,
        }));

      console.log(Routers);
      callback({
        Routers,
        Currentindex,
        producerStates,
      });
    });

    socket.on("getRouterindex", async ({ producerid }, callback) => {
      console.log("getRouterindex", producerid);
      callback({
        index: 1,
      });
    });

    socket.on("transport-connect", ({ dtlsParameters }) => {
      console.log("DTLS PARAMS... ", { dtlsParameters });

      getTransport(socket.id).connect({ dtlsParameters });
    });

    socket.on(
      "createWebRtcTransport",
      async ({ consumer, RouterId }, callback) => {
        console.log("createWebRtcTransport");

        const parsedPeers = await getPeers();
        const peers = new Map(Object.entries(parsedPeers));

        const peer = peers.get(socket.id);

        if (!peer) {
          console.error(`No peer found for socket ID: ${socket.id}`);
          return; // or handle this case as appropriate for your application
        }
        const roomName = peer.roomName;

        let router = workermap.get(Currentindex).router;

        await createWebRtcTransport(router)
          .then(
            (transport) => {
              callback({
                params: {
                  id: transport.id,
                  iceParameters: transport.iceParameters,
                  iceCandidates: transport.iceCandidates,
                  dtlsParameters: transport.dtlsParameters,
                },
              });

              // add transport to Peer's properties
              addTransport(transport, roomName, consumer);
            },
            (error) => {
              console.log(error);
            }
          )
          .then(
            console.log(
              `Transport Kind is ${consumer ? "Consumer" : "producer"}`
            )
          );
      }
    );

    socket.on("getProducers", async (callback) => {
      console.log("getProducers");
      const parsedPeers = await getPeers();
      const peers = new Map(Object.entries(parsedPeers));

      const roomName = peers.get(socket.id)?.roomName;
      console.log(producers);
      let producerList = [];
      await Promise.all(
        producers.map(async (producerData) => {
          if (
            producerData.socketId !== socket.id &&
            producerData.roomName === roomName
          ) {
            producerList.push(producerData.producer.id);
          }
        }),
        pipeExistingProducersToTargetRouter(socket)
      );

      console.log(typeof producerList); // Logging the type of producerList

      callback(producerList);
    });

    socket.on(
      "transport-produce",
      async ({ kind, rtpParameters, appData }, callback) => {
        console.log("transport-produce");
        const parsedPeers = await getPeers();
        const peers = new Map(Object.entries(parsedPeers));

        const peer = peers.get(socket.id);
        if (!peer) {
          console.log(`Peer does not exist for socket ID: ${socket.id}`);
          return callback({ error: "Peer not found." });
        }

        return new Promise(async (resolve, reject) => {
          try {
            let producer;

            if (kind === "video") {
              producer = await getTransport(socket.id).produce({
                kind,
                rtpParameters,
                encodings: [
                  { rid: "r0", maxBitrate: 100000, scalabilityMode: "S1T3" },
                  { rid: "r1", maxBitrate: 300000, scalabilityMode: "S1T3" },
                  { rid: "r2", maxBitrate: 900000, scalabilityMode: "S1T3" },
                ],
                codecOptions: {
                  videoGoogleStartBitrate: 1000,
                },
              });
            } else {
              producer = await getTransport(socket.id).produce({
                kind,
                rtpParameters,
              });
            }
            const Currentindex = participantRouterMap.get(socket.id);
            producerRouterMap.set(producer.id, Currentindex);

            const roomName = peers.get(socket.id).roomName;

            const transport = getTransport(socket.id);
            if (!transport) {
              console.error("Transport not found.");
              return;
            }

            addProducer(producer, roomName, kind);

            informConsumers(roomName, socket.id, producer.id, socket);

            console.log("Producer ID: ", producer.id, producer.kind);

            producer.on("transportclose", () => {
              console.log("transport for this producer closed ");
              producer.close();
            });

            console.log(producers.length);

            // Push task to Redis roomQueue
            const task = {
              socketId: socket.id,
              taskStatus: "completed",
              producerId: producer.id,
            };
            await pushToRoomQueue(task); // Push the task to the Redis queue

            callback({
              id: producer.id,
              producersExist: producers.length > 1 ? true : false,
            });

            resolve();
          } catch (error) {
            console.log(error);

            // If an error occurs, push failure status to the queue
            const task = {
              socketId: socket.id,
              taskStatus: "failed",
              error: error.message,
            };
            await pushToRoomQueue(task); // Push the failed task to the Redis queue

            reject(error);
          }
        });
      }
    );

    socket.on(
      "transport-recv-connect",
      async ({ dtlsParameters, serverConsumerTransportId }) => {
        console.log("transport-recv-connect");
        const consumerTransport = transports.get(
          serverConsumerTransportId
        )?.transport;

        if (consumerTransport) {
          await consumerTransport.connect({ dtlsParameters });
        } else {
          console.log(`${consumerTransport} not a transport`);
        }
      }
    );

    function removeItemsFromCollections(socketId) {
      producers = producers.filter((p) => p.socketId !== socketId);
      consumers = consumers.filter((c) => c.socketId !== socketId);
      transports = transports.filter((t) => t.socketId !== socketId);

      peers.delete(socketId);
      console.log(`Cleaned up resources for ${socketId}`);
    }

    socket.on(
      "consume",
      async (
        { rtpCapabilities, remoteProducerId, serverConsumerTransportId },
        callback
      ) => {
        try {
          console.log("consume");
          const parsedPeers = await getPeers();
          const peers = new Map(Object.entries(parsedPeers));

          const roomName = peers.get(socket.id).roomName;
          let router;
          if (alreadyPipedProducer.has(remoteProducerId)) {
            router = Trakpiped.get(remoteProducerId);
          } else {
            router = workermap.get(Currentindex).router;
          }

          console.log("Remote", router);
          let consumerTransport = transports.get(
            serverConsumerTransportId
          )?.transport;

          // check if the router can consume the specified producer
          if (
            router.canConsume({
              producerId: remoteProducerId,
              rtpCapabilities,
            })
          ) {
            console.log("consumercan consume");
            // transport can now consume and return a consumer
            const consumer = await consumerTransport.consume({
              producerId: remoteProducerId,
              rtpCapabilities,
              paused: true,
            });

            socket.on(
              "new-screen-share-producer",
              ({ producerId, roomName }) => {
                console.log(
                  `New screen share producer: ${producerId} in room: ${roomName}`
                );

                // Broadcast this producer ID to all other clients in the same room, except the sender
                io.to(roomName).emit("new-screen-share", { producerId });
              }
            );

            socket.on(
              "consumer-resume",
              async ({ serverConsumerId, producerId }) => {
                const consumerData = consumers.find(
                  (consumerData) =>
                    consumerData.consumer.id === serverConsumerId
                );
                const consumer = consumerData ? consumerData.consumer : null;

                if (!consumer || consumer.closed) {
                  console.error(
                    `Consumer with ID ${serverConsumerId} not found or already closed.`
                  );
                  return;
                }

                // Resume the producer if necessary
                if (producerId) {
                  const producer = producers.find(
                    (producerData) => producerData.producer.id === producerId
                  )?.producer;
                  if (producer && producer.paused) {
                    await producer.resume();
                  }
                }

                // Resume the consumer
                await consumer.resume();

                // Notify all clients in the room to resume the stream
                io.to(socket.roomName).emit("stream-resumed", {
                  producerId,
                  serverConsumerId,
                });
              }
            );

            socket.on(
              "consumer-pause",
              async ({ serverConsumerId, producerId }) => {
                console.log(serverConsumerId, producerId);
                const { consumer } = consumers.find(
                  (consumerData) =>
                    consumerData.consumer.id === serverConsumerId
                );
                await consumer.pause();

                producers.forEach(async (producerData) => {
                  if (producerData.producer.id === producerId) {
                    await producerData.producer.pause();
                  }
                });

                // Notify all clients in the room to pause the stream
                io.to(socket.roomName).emit("stream-paused", {
                  producerId,
                  serverConsumerId,
                });
              }
            );
            function removeConsumer(consumerId) {
              consumers = consumers.filter(
                (consumerData) => consumerData.consumer.id !== consumerId
              );
            }
            socket.on("consumer-close", ({ serverConsumerId }) => {
              const { consumer } = consumers.find(
                (consumerData) => consumerData.consumer.id === serverConsumerId
              );
              if (consumer) {
                consumer.close();
                removeConsumer(serverConsumerId);
              }
            });
            socket.on("producer-close", ({ producerId }) => {
              producers.forEach((producerData) => {
                if (producerData.producer.id === producerId) {
                  producerData.producer.close();
                }
              });
            });

            if (consumer.paused) {
              console.log("Consumer is currently paused");
            }

            if (consumer.closed) {
              console.log("Consumer is closed");
            }

            consumer.on("transportclose", () => {
              console.log("transport close from consumer");
            });

            consumer.on("producerclose", () => {
              console.log("producer of consumer closed");
              socket.emit("producer-closed", { remoteProducerId });

              consumerTransport.close([]);
              transports = transports.filter(
                (transportData) =>
                  transportData.transport.id !== consumerTransport.id
              );
              consumer.close();
              consumers = consumers.filter(
                (consumerData) => consumerData.consumer.id !== consumer.id
              );
            });

            addConsumer(consumer, roomName);

            const params = {
              id: consumer.id,
              producerId: remoteProducerId,
              kind: consumer.kind,
              rtpParameters: consumer.rtpParameters,
              serverConsumerId: consumer.id,
            };

            callback({ params });
          }
        } catch (error) {
          console.log(error.message);
          callback({
            params: {
              error: error,
            },
          });
        }
      }
    );

    socket.on("disconnect", async () => {
      console.log("peer disconnected");

      // Get all consumers associated with this socket
      const userConsumers = consumers.filter((c) => c.socketId === socket.id);
      const consumerIds = userConsumers.map((c) => c.consumer.id);

      // Get all producers associated with this socket
      const userProducers = producers.filter((p) => p.socketId === socket.id);

      // Notify others about each producer that's being closed
      userProducers.forEach((producerData) => {
        socket.broadcast.to(socket.roomName).emit("producer-closed", {
          remoteProducerId: producerData.producer.id,
        });
        producerData.producer.close();
      });

      // Notify about consumer closures
      socket.broadcast.to(socket.roomName).emit("user-disconnected", {
        consumerIds: consumerIds || [],
      });

      // Clean up producers
      producers = producers.filter((p) => p.socketId !== socket.id);

      // Clean up consumers
      consumers = consumers.filter((c) => c.socketId !== socket.id);
      userConsumers.forEach((c) => {
        c.consumer.close();
      });

      // Clean up transports
      transports = removeItems(transports, socket.id, "transport");

      // Leave room and clean up peer
      if (peers.get(socket.id)) {
        const parsedPeers = await getPeers();
        const peers = new Map(Object.entries(parsedPeers));

        const roomName = peers.get(socket.id).roomName;
        socket.leave(roomName);
        deleteFromPeers(socket.id);
      }
    });
  });
};
