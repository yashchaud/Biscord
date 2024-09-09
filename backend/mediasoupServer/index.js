var app = require("./app");
var debug = require("debug")("backend:server");
const https = require("https");
var { Server } = require("socket.io");
var Socketsetup = require("./socket");
const fs = require("fs");
const cors = require("cors");

const ports = 3000;

var port = normalizePort(ports || "3004");
const corsOptions = {
  origin: "https://www.yashportfoliohub.site", // Specify the origin of your frontend application
  credentials: true, // This allows cookies and credentials to be included in the requests
};
app.use(cors(corsOptions));
// app.set("port", port);

// const privateKey = fs.readFileSync("./sslcert/key.pem", "utf8");
// const certificate = fs.readFileSync("./sslcert/cert.pem", "utf8");

// const credentials = { key: privateKey, cert: certificate };

// const server = https.createServer(credentials, app);

const server = app.listen(port, () => {
  console.log(`Server is working on http://localhost:${port}`);
});

// server.listen(port, "0.0.0.0");

server.on("error", onError);
server.on("listening", onListening);

// Initialize Socket.IO after the server is created
const io = new Server(server, {
  cors: {
    origin: "https://www.yashportfoliohub.site",
    credentials: true,
  },
});
Socketsetup(io);

function normalizePort(val) {
  var port = parseInt(val, 10);

  if (isNaN(port)) {
    return val;
  }

  if (port >= 0) {
    return port;
  }

  return false;
}
function onError(error) {
  if (error.syscall !== "listen") {
    throw error;
  }

  var bind = typeof port === "string" ? "Pipe " + port : "Port " + port;

  switch (error.code) {
    case "EACCES":
      console.error(bind + " requires elevated privileges");
      process.exit(1);
      break;
    case "EADDRINUSE":
      console.error(bind + " is already in use");
      process.exit(1);
      break;
    default:
      throw error;
  }
}

function onListening() {
  var addr = server.address();
  var bind = typeof addr === "string" ? "pipe " + addr : "port " + addr.port;
  debug("Listening on " + bind);
}
