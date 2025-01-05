const { redisClient } = require("./redis"); // Assuming redisClient is initialized in redis.js

const SERVER_ID = `mediasoup_server_${process.pid}`;

/**
 * Get Functions
 */
async function getRoomQueue() {
  const roomQueue = await redisClient.lRange(`${SERVER_ID}:roomQueue`, 0, -1);
  return roomQueue.map((task) => JSON.parse(task));
}

async function getWorkermap() {
  const workermap = await redisClient.hGetAll(`${SERVER_ID}:workermap`);
  Object.keys(workermap).forEach((key) => {
    workermap[key] = JSON.parse(workermap[key]);
  });
  return workermap;
}

async function getRooms() {
  const rooms = await redisClient.hGetAll(`${SERVER_ID}:rooms`);

  // Iterate through each room and parse its JSON, converting the 'peers' array to a Set
  Object.keys(rooms).forEach((roomName) => {
    const roomData = JSON.parse(rooms[roomName]);

    // Convert 'peers' array back into a Set
    roomData.peers = new Set(roomData.peers);

    // Update the room data in the rooms object
    rooms[roomName] = roomData;
  });

  return rooms;
}

async function getPeers() {
  const peers = await redisClient.hGetAll(`${SERVER_ID}:peers`);
  Object.keys(peers).forEach((socketId) => {
    peers[socketId] = JSON.parse(peers[socketId]);
  });
  return peers;
}

/**
 * Push Functions
 */
async function pushToRoomQueue(task) {
  await redisClient.rPush(`${SERVER_ID}:roomQueue`, JSON.stringify(task));
}

async function addToWorkermap(key, value) {
  await redisClient.hSet(`${SERVER_ID}:workermap`, key, JSON.stringify(value));
}

async function addToRooms(roomName, roomData) {
  const newRoomData = {
    ...roomData,
    peers: Array.from(roomData.peers), // Convert Set to array
  };

  await redisClient.hSet(
    `${SERVER_ID}:rooms`,
    roomName,
    JSON.stringify(newRoomData)
  );
}

async function addToPeers(socketId, peerData) {
  await redisClient.hSet(
    `${SERVER_ID}:peers`,
    socketId,
    JSON.stringify(peerData)
  );
}

/**
 * Delete Functions
 */
async function deleteFromRoomQueue(task) {
  await redisClient.lRem(`${SERVER_ID}:roomQueue`, 0, JSON.stringify(task));
}

async function deleteFromWorkermap(key) {
  await redisClient.hDel(`${SERVER_ID}:workermap`, key);
}

async function deleteFromRooms(roomName) {
  await redisClient.hDel(`${SERVER_ID}:rooms`, roomName);
}

async function deleteFromPeers(socketId) {
  await redisClient.hDel(`${SERVER_ID}:peers`, socketId);
}

/**
 * Exported Functions
 */
module.exports = {
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
};
