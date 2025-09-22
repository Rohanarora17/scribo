import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import { Redis } from "@upstash/redis";

dotenv.config();

// --- Types ---
type DrawingData = string; // (Serialized CanvasDraw state)
interface PlayerData {
  nickname: string;
  wallet: string;
  joinedAt: number;
}
interface RoomMeta {
  fee: string;
  createdAt: number;
  asset?: string;
  roundEnd: number | null;
  owner?: string;
}

// --- Parsing helpers ---
function parseRoomMeta(raw: Record<string, string | undefined>): RoomMeta {
  return {
    fee: raw.fee ?? "",
    createdAt: raw.createdAt ? Number(raw.createdAt) : Date.now(),
    asset: raw.asset,
    roundEnd: raw.roundEnd ? Number(raw.roundEnd) : null,
    owner: raw.owner,
  };
}
function parsePlayerData(raw: Record<string, string | undefined>): PlayerData {
  return {
    nickname: raw.nickname ?? "",
    wallet: raw.wallet ?? "",
    joinedAt: raw.joinedAt ? Number(raw.joinedAt) : Date.now(),
  };
}

// --- Redis Setup ---
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// --- Express/Socket.IO Setup ---
const app = express();
const server = http.createServer(app);
app.use(cors({ origin: "*" }));
const io = new Server(server, { cors: { origin: "*" } });

// --- Helpers ---
async function setRoomMeta(roomId: string, meta: Partial<RoomMeta>) {
  const fieldsToSet: Record<string, string> = {};
  for (const key in meta) {
    const typedKey = key as keyof RoomMeta;
    const value = meta[typedKey];
    if (value !== undefined && value !== null) {
      fieldsToSet[typedKey] = String(value);
    }
  }
  if (Object.keys(fieldsToSet).length > 0) {
    await redis.hset(`room:${roomId}:meta`, fieldsToSet);
  }
}

async function setPlayer(roomId: string, socketId: string, data: Partial<PlayerData>) {
  const fieldsToSet: Record<string, string> = {};
  for (const key in data) {
    const typedKey = key as keyof PlayerData;
    const value = data[typedKey];
    if (value !== undefined && value !== null) {
      fieldsToSet[typedKey] = String(value);
    }
  }
  if (Object.keys(fieldsToSet).length > 0) {
    await redis.hset(`room:${roomId}:player:${socketId}`, fieldsToSet);
  }
}

async function getAllPlayers(roomId: string): Promise<Record<string, PlayerData>> {
  const keys = await redis.keys(`room:${roomId}:player:*`);
  const result: Record<string, PlayerData> = {};
  for (const key of keys) {
    const id = key.split(":").pop()!;
    const dataRaw = await redis.hgetall(key);
    if (dataRaw) result[id] = parsePlayerData(dataRaw as Record<string, string | undefined>);
  }
  return result;
}

async function getAllDrawings(roomId: string): Promise<Record<string, DrawingData>> {
  const keys = await redis.keys(`room:${roomId}:graph:*`);
  const result: Record<string, DrawingData> = {};
  for (const key of keys) {
    const id = key.split(":").pop()!;
    const drawing = await redis.get(key);
    if (drawing) result[id] = drawing as string;
  }
  return result;
}

async function getRoomMeta(roomId: string): Promise<RoomMeta> {
    const metaRaw = await redis.hgetall(`room:${roomId}:meta`);
    return parseRoomMeta(metaRaw as Record<string, string | undefined>);
  }
  
  async function broadcastMeta(roomId: string) {
    const meta = await getRoomMeta(roomId);
    io.to(roomId).emit("meta", meta);
  }

// --- Socket.IO Logic ---
io.on("connection", (socket: Socket) => {
  // --- Room Create from Lobby ---
  socket.on("create_lobby_room", async ({ entryFee, maxParticipants, wallet, nickname, roomId }) => {
    if (!roomId) {
      socket.emit("room_create_error", { error: "No roomId from contract." });
      return;
    }
    // Store initial meta, mark owner
    await setRoomMeta(roomId, {
      fee: entryFee,
      createdAt: Date.now(),
      roundEnd: null,
      owner: wallet
    });
    // Add owner as first player
    await setPlayer(roomId, socket.id, {
      nickname,
      wallet,
      joinedAt: Date.now(),
    });
    socket.emit("room_created", { roomId });
  });

  // --- Join: No timer auto-start, just join room and set player
  socket.on(
    "join",
    async ({
      roomId,
      nickname,
      wallet,
      fee,
      asset,
    }: {
      roomId: string;
      nickname: string;
      wallet: string;
      fee: string;
      asset?: string;
    }) => {
      socket.join(roomId);
  
      await setRoomMeta(roomId, { asset });
  
      await redis.hset(`room:${roomId}:player:${socket.id}`, {
        nickname,
        wallet,
        joinedAt: Date.now().toString(),
      });
  
      // --- ADD THESE TWO LINES ---
      broadcastUsers(roomId, socket.id);
      broadcastMeta(roomId); // <-- This sends the fee and prize info
    }
  );

  // --- Explicit Start Round ---
  socket.on("start_round", async ({ roomId, wallet }) => {
    const metaRaw = await redis.hgetall(`room:${roomId}:meta`);
    const meta = parseRoomMeta(metaRaw as Record<string, string | undefined>);
    if (wallet !== meta.owner) {
      socket.emit("start_round_error", { error: "Only room owner can start round." });
      return;
    }
    if (meta.roundEnd && Number(meta.roundEnd) > Date.now()) {
      socket.emit("start_round_error", { error: "Round already started." });
      return;
    }
    const roundEnd = Date.now() + 5 * 60 * 1000;
    await setRoomMeta(roomId, { roundEnd });
    io.to(roomId).emit("round_started", { roundEnd, owner: meta.owner });
    startTimer(roomId); // Will emit timer every second
  });

  // Allow user to change nickname
  socket.on("set_nickname", async ({ roomId, nickname }) => {
    await setPlayer(roomId, socket.id, { nickname });
    broadcastUsers(roomId, socket.id);
  });

  // User drawing submission
  socket.on(
    "drawing_submit",
    async ({ roomId, drawing }: { roomId: string; drawing: DrawingData }) => {
      await redis.set(`room:${roomId}:graph:${socket.id}`, drawing);
      io.to(roomId).emit("drawing", { id: socket.id, data: drawing });
    }
  );

  // Handle disconnect, clean up player
  socket.on("disconnect", async () => {
    const rooms = Array.from(socket.rooms).filter((id) =>
      id.startsWith("room:")
    );
    for (const room of rooms) {
      await redis.del(`room:${room}:player:${socket.id}`);
      await redis.del(`room:${room}:graph:${socket.id}`);
      broadcastUsers(room, socket.id);
    }
  });

  // --- Timer Logic ---
  async function startTimer(roomId: string) {
    const metaRaw = await redis.hgetall(`room:${roomId}:meta`);
    const meta = parseRoomMeta(metaRaw as Record<string, string | undefined>);
    if (!meta.roundEnd) return;
    const roundEnd = Number(meta.roundEnd);

    const interval = setInterval(async () => {
      const now = Date.now();
      let timeLeft = Math.max(0, Math.floor((roundEnd - now) / 1000));
      io.to(roomId).emit("timer", timeLeft);
      if (timeLeft <= 0) {
        clearInterval(interval);
        // On round end, emit all drawings & meta to clients
        const drawings = await getAllDrawings(roomId);
        const players = await getAllPlayers(roomId);
        const metaRawFinal = await redis.hgetall(`room:${roomId}:meta`);
        const metaFinal = parseRoomMeta(metaRawFinal as Record<string, string | undefined>);
        io.to(roomId).emit("round_end", {
          meta: metaFinal,
          players,
          drawings,
        });
        // Optionally: reset/delete room state for new round here
      }
    }, 1000);
  }

  // --- User List Broadcast ---
  async function broadcastUsers(roomId: string, selfId: string) {
    const players = await getAllPlayers(roomId);
    const users = Object.entries(players).map(([id, data]) => ({
      id,
      nickname: data.nickname,
      wallet: data.wallet,
      isSelf: id === selfId,
    }));
    io.to(roomId).emit("users", users);
  }
});

// --- Base HTTP endpoint ---
app.get("/", (_, res) => {
  res.send(
    "Socket.IO backend (TS) with Upstash Redis is running! Connect with your client."
  );
});

// --- Start server ---
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Socket.IO server running on http://localhost:${PORT}`);
});
