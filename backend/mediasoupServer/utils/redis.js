const { createClient } = require("redis");

const redisClient = createClient();
redisClient.on("error", (err) => console.error("Redis error:", err));

(async () => {
  await redisClient.connect();
  console.log("Connected to Redis");
})();

const setRedisData = async (key, value) => {
  await redisClient.set(key, JSON.stringify(value));
};

const getRedisData = async (key) => {
  const data = await redisClient.get(key);
  return data ? JSON.parse(data) : null;
};

const deleteRedisKey = async (key) => {
  await redisClient.del(key);
};

const pushToRedisList = async (key, value) => {
  await redisClient.rPush(key, JSON.stringify(value));
};

const getRedisList = async (key) => {
  const list = await redisClient.lRange(key, 0, -1);
  return list.map((item) => JSON.parse(item));
};

module.exports = {
  redisClient,
  setRedisData,
  getRedisData,
  deleteRedisKey,
  pushToRedisList,
  getRedisList,
};
