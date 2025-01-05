const WorkerManager = require('./modules/WorkerManager');
const RoomManager = require('./modules/RoomManager');
const TransportManager = require('./modules/TransportManager');
const ProducerConsumerManager = require('./modules/ProducerConsumerManager');
const PipeManager = require('./modules/PipeManager');
const MetricsManager = require('./modules/MetricsManager');

class MediasoupManager {
  constructor() {
    this.metricsManager = new MetricsManager();
    this.workerManager = new WorkerManager(this.metricsManager.metrics);
    this.roomManager = new RoomManager();
    this.transportManager = new TransportManager(this.metricsManager.metrics);
    this.producerConsumerManager = new ProducerConsumerManager();
    this.pipeManager = new PipeManager();

    this.mediaCodecs = [
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

    // Start monitoring
    setInterval(() => this.monitorResources(), 5000);
  }

  async initialize() {
    await this.workerManager.createWorkers(this.mediaCodecs);
  }

  async handleJoinRoom(socket, roomName) {
    // Always use router0 as the main router
    const router0 = this.workerManager.getRouter(0);
    if (!router0) {
      throw new Error('Primary router not available');
    }

    // Try to get router1, but fall back to router0 if not available
    const router1 = this.workerManager.getRouter(1) || router0;
    
    // Always use index 0 for now to ensure stability
    const routerIndex = 0;
    
    // Check if the room exists and the participant is already in it
    const isInRoom = this.roomManager.isParticipantInRoom(roomName, socket.id);
    if (isInRoom) {
      throw new Error('Already joined this room');
    }
    
    await this.roomManager.createRoom(roomName, socket.id, routerIndex, router0);
    
    // Get existing producers in the room and validate their state
    const roomProducers = this.producerConsumerManager.getRoomProducers(roomName, socket.id);
    const validProducers = roomProducers.filter(producer => {
      const isValid = producer && !producer.closed;
      if (!isValid) {
        this.producerConsumerManager.removeProducer(producer.id);
      }
      return isValid;
    });
    
    // Get capabilities of both routers
    const routerCapabilities = [
      router0.rtpCapabilities,
      router1.rtpCapabilities
    ];
    
    // Pipe existing producers if needed
    for (const producerInfo of validProducers) {
      try {
        const producer = this.producerConsumerManager.getProducer(producerInfo.id);
        if (!producer || producer.closed) {
          continue;
        }
        
        const sourceRouterIndex = this.producerConsumerManager.getProducerRouter(producerInfo.id);
        if (sourceRouterIndex !== routerIndex) {
          const sourceRouter = this.workerManager.getRouter(sourceRouterIndex);
          if (sourceRouter) {
            await this.pipeManager.pipeProducerToRouter(producer, sourceRouter, router0);
          }
        }
      } catch (error) {
        logger.error('Error piping producer', {
          producerId: producerInfo.id,
          error: error.message
        });
      }
    }

    return {
      Routers: routerCapabilities,
      Currentindex: routerIndex,  // Always 0 for stability
      producerStates: validProducers.map(producer => ({
        producerId: producer.id,
        isPaused: producer.paused,
        kind: producer.kind
      }))
    };
  }

  async handleTransportCreate(socket, { consumer }) {
    const routerIndex = this.roomManager.getParticipantRouter(socket.id);
    const router = this.workerManager.getRouter(routerIndex);
    
    if (!router) {
      throw new Error('Router not found');
    }

    const transport = await this.transportManager.createWebRtcTransport(router);
    await this.transportManager.addTransport(transport, socket.id, socket.roomName, consumer);

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  async handleTransportConnect(transportId, dtlsParameters) {
    const transport = this.transportManager.getTransport(transportId);
    if (!transport) {
      throw new Error('Transport not found');
    }
    await transport.connect({ dtlsParameters });
  }

  async handleTransportProduce(socket, { kind, rtpParameters, appData }) {
    const transport = this.transportManager.getProducerTransport(socket.id);
    if (!transport) {
      throw new Error('Transport not found');
    }

    const routerIndex = this.roomManager.getParticipantRouter(socket.id);
    let producer;

    if (kind === "video") {
      producer = await transport.produce({
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
      producer = await transport.produce({
        kind,
        rtpParameters,
      });
    }

    await this.producerConsumerManager.addProducer(
      producer,
      socket.id,
      socket.roomName,
      routerIndex,
      kind
    );

    return producer.id;
  }

  async handleConsume(socket, { producerId, rtpCapabilities }) {
    if (!socket.roomName) {
      throw new Error('Not in a room');
    }

    const routerIndex = this.roomManager.getParticipantRouter(socket.id);
    const router = this.workerManager.getRouter(routerIndex);
    
    if (!router) {
      throw new Error('Router not found');
    }

    // Validate RTP Capabilities
    if (!rtpCapabilities || typeof rtpCapabilities !== 'object') {
      throw new Error('Invalid RTP capabilities');
    }

    // Get and validate producer
    const producer = this.producerConsumerManager.getProducer(producerId);
    if (!producer) {
      throw new Error('Producer not found');
    }

    if (producer.closed) {
      this.producerConsumerManager.removeProducer(producerId);
      throw new Error('Producer is closed');
    }

    // Verify the producer is in the same room
    const producerData = this.producerConsumerManager.getProducerData(producerId);
    if (!producerData || producerData.roomName !== socket.roomName) {
      throw new Error('Producer not in the same room');
    }

    // Check if we can consume
    if (!router.canConsume({
      producerId: producer.id,
      rtpCapabilities,
    })) {
      throw new Error('Cannot consume this producer with given RTP capabilities');
    }

    // Check if we need to use a piped consumer
    const producerRouterIndex = this.producerConsumerManager.getProducerRouter(producerId);
    if (producerRouterIndex !== routerIndex) {
      try {
        const sourceRouter = this.workerManager.getRouter(producerRouterIndex);
        if (!sourceRouter) {
          throw new Error('Source router not found');
        }
        
        const pipeData = await this.pipeManager.pipeProducerToRouter(
          producer,
          sourceRouter,
          router
        );
        
        if (!pipeData) {
          throw new Error('Failed to pipe producer');
        }
      } catch (error) {
        throw new Error(`Failed to pipe producer: ${error.message}`);
      }
    }

    const transport = this.transportManager.getProducerTransport(socket.id);
    if (!transport) {
      throw new Error('Transport not found');
    }

    try {
      const consumer = await this.producerConsumerManager.createConsumer(
        transport,
        producer,
        rtpCapabilities,
        socket.id,
        socket.roomName
      );

      if (!consumer) {
        throw new Error('Failed to create consumer');
      }

      // Set up consumer cleanup
      consumer.on('producerclose', () => {
        this.producerConsumerManager.removeConsumer(consumer.id);
      });

      consumer.on('transportclose', () => {
        this.producerConsumerManager.removeConsumer(consumer.id);
      });

      return {
        id: consumer.id,
        producerId: producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: producer.type,
        producerPaused: producer.paused
      };
    } catch (error) {
      throw new Error(`Failed to set up consumer: ${error.message}`);
    }
  }

  async handleDisconnect(socket) {
    this.transportManager.removeTransportsForPeer(socket.id);
    this.producerConsumerManager.removeAllPeerProducers(socket.id);
    this.producerConsumerManager.removeAllPeerConsumers(socket.id);
    
    if (socket.roomName) {
      this.roomManager.removeParticipant(socket.roomName, socket.id);
    }

    // Update metrics
    this.updateMetrics();
  }

  getOptimalRouterIndex() {
    // Ensure we only return 0 or 1 as the index
    const routerCount = Math.min(2, this.workerManager.getAllRouters().length);
    return Math.floor(Math.random() * routerCount);
  }

  async monitorResources() {
    await this.workerManager.monitorWorkers();
    await this.transportManager.monitorTransports();
    this.updateMetrics();
  }

  updateMetrics() {
    const metrics = {
      userCount: this.roomManager.participantRouterMap.size,
      producerCount: this.producerConsumerManager.producers.length,
      consumerCount: this.producerConsumerManager.consumers.length,
      roomCount: this.roomManager.rooms.size,
      routerCount: this.workerManager.getAllRouters().length,
    };

    this.metricsManager.updateUserCount(metrics.userCount);
    this.metricsManager.updateProducerCount(metrics.producerCount);
    this.metricsManager.updateConsumerCount(metrics.consumerCount);
    this.metricsManager.updateRoomCount(metrics.roomCount);
    this.metricsManager.updateRouterCount(metrics.routerCount);
  }
}

module.exports = MediasoupManager; 