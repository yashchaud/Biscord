# Building Discord-Style Video Chat: A Journey of Pain, Glory, and Too Many CPU Cores 🎮

![Mediasoup Architecture Overview](./images/mediasoup-architecture.png)

> "So you want to build video chat that doesn't explode when more than 3 people join? Hold my WebSocket! 🍺"

Ever tried adding that fourth person to your WebRTC call? Suddenly your beautiful peer-to-peer masterpiece turns into a CPU-melting disaster. One minute you're high-fiving yourself for connecting two peers, the next you're explaining to your boss why the server's having an existential crisis because the entire marketing team tried to join the morning standup.

Don't worry, fellow code warrior! Put down that "WebRTC for Dummies" book and grab your favorite energy drink. We're about to turn your "works on my machine (with exactly 3 users)" prototype into a scalable video powerhouse that Discord would be proud of! 🚀

## The TLDR (Too Long; Didn't Run-out-of-memory)

- We built a video chat that doesn't die when your entire Discord server joins
- Learned why CPU cores are like pizza slices - you never have enough
- Found out why "just add more servers" is like trying to solve a CPU problem with hopes and prayers
- Wrote code that actually works (most of the time™)
- Coming up: A full blog series where we spill all our secrets!

## Why Are We Writing This?

Picture this: You're a developer who just got asked to add video chat to your app. "Easy peasy!" you think, cracking your knuckles. Three Stack Overflow copies and five tutorials later, you have two peers connected! Victory!

Then reality hits:

- "Can we have 100 people in a room?"
- "Why is my CPU fan taking off like a jet engine?"
- "Why does everyone look like a Minecraft character on 2G internet?"

Been there, done that, bought the t-shirt (and several new CPU coolers).

## The "Why SFU" in 30 Seconds

Imagine you're hosting a party (video call), and everyone needs to talk to everyone else. In a peer-to-peer world, each person would need to shout directly to every other person. With 70 people, that's... well, chaos!

Enter SFU (Selective Forwarding Unit) - think of it as that one friend who's great at passing messages. Instead of everyone shouting at everyone, they whisper to this friend who then efficiently passes it along. Much better! 🎯

## The Math That Made Our Server Cry 😱

Let's talk real numbers :

```javascript
// The "Oh No" Calculator
const calculatePainLevel = (users) => {
  const producersPerUser = 2; // Video + Audio
  const producers = users * producersPerUser;
  const consumersPerUser = (users - 1) * producersPerUser;
  const totalConsumers = users * consumersPerUser;

  return {
    producers,
    consumers: totalConsumers,
    serverPainLevel: "🔥".repeat(
      Math.min(5, Math.floor(totalConsumers / 1000))
    ),
  };
};
```

Every person in your call is both talking (producing) and listening (consuming). With 4 people, it's like having 4 TV channels, and everyone's watching everyone else's channel. Cute, right? Now imagine 100 people - suddenly your poor server is juggling more streams than Netflix on Super Bowl night!

Let's break it down with our favorite example:

```javascript
// With 4 users:
// - Each peer receives audio and video from 3 peers, so 3x2 = 6 consumers in total.
// - There are 4 peers, so 4x6 = 24 consumers in total.
```

Translation: With 4 people, your server is handling 24 video/audio streams - which is actually a walk in the park! While a CPU core can theoretically handle about 500 WebRTC transports, real-world scenarios are trickier. Each user needs connections for both sending and receiving, plus cores need to talk to each other behind the scenes. Think of it like a game of digital hot potato, but everyone's throwing and catching at the same time!

So in practice, we aim for around 100 ish connections per core to keep things running smoothly. Why so much lower? Because just like you wouldn't fill your car's gas tank to the absolute brim, we need that extra capacity for all the behind-the-scenes juggling that makes multi-core magic happen.

But here's where it gets interesting... When your daily standup turns into an impromptu screen-sharing festival, with Dave from design sharing mockups, Sarah from sales pulling up dashboards, and three people forgetting to mute their mics (we hear your mechanical keyboard, Steve 👀), that's when you need some clever optimization. How do we keep things smooth when real-world chaos hits? We've got some elegant solutions that would make a distributed systems engineer smile...

### The Magic of Selective Streaming 🪄

Remember that "100 users in a room" problem? Here's our secret sauce:

```javascript
class SmartRoom {
  constructor() {
    this.activeProducers = new Map();
    this.visiblePeers = new Map(); // Per user visible peers
  }

  async handlePeerVisibility(peerId, visiblePeerIds) {
    // The real MVP: Only stream what users can actually see!
    const peer = this.peers.get(peerId);

    // Pause producers for non-visible peers
    for (const producer of peer.producers.values()) {
      if (!visiblePeerIds.includes(producer.peerId)) {
        await producer.pause();
        // CPU: "Thank you for your service! 🫡"
      }
    }
  }
}
```

2. **Multi-Core Magic: Sharing is Caring** 💫

Imagine a busy restaurant kitchen where each chef (CPU core) needs to not only cook their own orders but also share ingredients and recipes with other chefs. That's exactly what our cores do!

Here's the real deal: While a core can theoretically handle 500 connections, reality is messier. Each core needs to:

- Send its video streams to other cores (Hey Core B, here's what my users are up to!)
- Receive streams from other cores (Thanks Core A, my users want to see your users too!)
- Keep some capacity free for these "kitchen exchanges"

So in practice, we aim for about 100-ish connections per core to keep things running smoothly. It's like leaving breathing room in the kitchen so chefs can actually move around instead of playing human Tetris!

The real kitchen coordination looks like this:

- Core A: "Getting busy here, need to share some of these orders!"
- Core B: "I'll help, but remember I need to send my orders your way too"
- Core C: "Got space in my kitchen, send them over"
- Everyone: "Let's keep some counter space clear for all this sharing!" ✨

3. **The Secret Sauce: Stateless Servers** 🧙‍♂️

Remember those "microservices" everyone keeps talking about? This is where they shine! Instead of having servers that try to remember everything (like that one friend who insists on memorizing everyone's coffee order), we make our media servers beautifully forgetful.

Here's how our magic works:

- Media servers are like skilled bartenders who can make any drink but don't need to remember your usual order
- Our signaling server is the master coordinator, telling each server exactly what to do
- A smart broker (think: air traffic controller) keeps track of which servers are handling what

```javascript
// Simplified broker logic - In plain English:
// This is like a smart receptionist who:
// 1. Checks which servers aren't too busy
// 2. Picks the least busy one
// 3. Sends the new person there with all the info they need
class MediaBroker {
  handleNewConnection(userId, roomId) {
    // Find the least loaded server
    const targetServer = this.servers
      .filter((server) => server.isHealthy())
      .sort((a, b) => a.load - b.load)[0];

    return {
      server: targetServer,
      // Include everything needed for this connection
      // No server memory required! 🧠
      connectionDetails: this.getRoomState(roomId),
    };
  }
}
```

But what happens when things go wrong? (Because they will, Murphy's law is very real in video calls!)

Imagine you're in a video call and the server handling your room decides to take an unscheduled nap. In a stateful world, it's like the host of a party suddenly vanishing - chaos! But in our stateless setup:

1. The broker notices Server A is down (RIP)
2. It quickly checks its little black book (room registry)
3. Sees "Ah, daily standup room was on Server A"
4. Picks Server B (which is chilling with low load)
5. Tells the signaling server "Hey, move these folks to Server B"
6. Users might notice a tiny hiccup (like a 200ms "loading" spinner)
7. But then they're back to complaining about who forgot to mute!

```javascript
// Failover magic - In plain English:
// This is like an event planner who:
// 1. Notices one venue had to close
// 2. Quickly finds all the events scheduled there
// 3. Moves them to different venues
// 4. Does it so smoothly guests barely notice
async handleServerFailure(deadServer) {
  const affectedRooms = this.getRoomsOnServer(deadServer);

  for (const room of affectedRooms) {
    const newServer = this.findHealthyServer();
    await this.migrationOrchestrator.moveRoom(room, newServer);
    // Users be like: "Did something happen? 🤔"
    // Us: "Nothing to see here! 😎"
  }
}
```

The best part? Because our servers are stateless, they're like LEGO blocks - perfectly interchangeable. Need to handle more users? Add more blocks! Server acting up? Swap it out! It's like hot-swapping parts in your gaming PC, but for an entire video infrastructure.

4. **Smart Streaming: The Art of Showing What Matters** 🎨
   ```javascript
   const visiblePeers = 12; // What fits on one screen
   const actualConsumers = audioConsumers + visiblePeers(videoConsumers); // Much better!
   ```

## Why We're Really Writing This

Let's be honest - Mediasoup is like that genius friend who gives you all the tools but expects you to figure out how to build the rocket ship. Their philosophy? "Here are the powerful low-level APIs, now go build something cool!"

Which is exactly what makes it powerful... but also why your first week with Mediasoup feels like trying to solve a Rubik's cube blindfolded!

That's why we're here. We fought the battles, made the mistakes, and somehow got it working. Now we're sharing our war stories so you don't have to learn everything the hard way (though some things you'll definitely learn the hard way - it's a rite of passage 😉).

## The Bottom Line

Building scalable video chat is like building a house of cards while juggling - it's tricky, but with the right approach (and enough caffeine), it's totally doable. We'll show you how!

---

> ## Want to Try Our (Currently Sloppy) Implementation?
>
> Check out our [GitHub repo](https://github.com/yashchaud/Biscord.git). It's like a beta version of what we'll build in this series - it works, but
> don't judge our variable names! 😅

---

_Next up: We'll start our journey into the rabbit hole of WebRTC and Mediasoup. Bring snacks, it's going to be a wild ride! 🎢_
