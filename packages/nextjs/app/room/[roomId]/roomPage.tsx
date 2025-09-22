"use client";
import { useEffect, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import io, { Socket } from "socket.io-client";
import { useAccount } from "wagmi";
import { ReactSketchCanvas, ReactSketchCanvasRef } from "react-sketch-canvas";

// Helper to parse query string (Next.js App Router offers useSearchParams)
const getQueryParam = (name: string): string | null => {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
};

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

interface Player {
  id: string;
  nickname: string;
  isSelf: boolean;
  wallet?: string;
}
interface RoomMeta {
  fee: string;
  createdAt: number;
  asset?: string;
  roundEnd?: number;
  owner?: string;
}
interface RoomPageProps {
  roomId: string;
}

export default function RoomPage({ roomId }: RoomPageProps) {
  const { address: connectedAddress } = useAccount();
  const socketRef = useRef<Socket | null>(null);
  const canvasRef = useRef<ReactSketchCanvasRef>(null);

  // --- State ---
  const [users, setUsers] = useState<Player[]>([]);
  const [drawings, setDrawings] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [timer, setTimer] = useState(300);
  const [roundStarted, setRoundStarted] = useState(false);
  const [owner, setOwner] = useState<string>("");
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [selfNickname, setSelfNickname] = useState<string>("");

  // --- On mount: Fetch meta/nickname from params or backend. JOIN room.
  useEffect(() => {
    if (!roomId || !connectedAddress) return;

    // Try to get nickname from query/state
    let nickname = getQueryParam("nickname");
    if (!nickname) {
      // fallback: find self in Zustand/global if needed
      nickname = ""; // or your store logic
    }
    setSelfNickname(nickname ?? "");

    const socket: Socket = io(SOCKET_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.emit("join", {
      roomId,
      nickname,
      wallet: connectedAddress,
    });

    socket.on("users", (users: Player[]) => setUsers(users));
    socket.on("drawing", ({ id, data }) => setDrawings((d) => ({ ...d, [id]: data })));
    socket.on("timer", setTimer);

    // Meta/info: Listen for meta from backend per room
    socket.on("meta", (metaDetails: RoomMeta) => setMeta(metaDetails));
    // Backend should emit room meta on first join or provide from DB

    socket.on("round_end", () => {
      setSubmitted(false);
      setRoundStarted(false);
      setTimer(0);
      canvasRef.current?.clearCanvas();
    });

    socket.on("round_started", ({ roundEnd, owner: roomOwner }) => {
      setRoundStarted(true);
      setTimer(Math.floor((roundEnd - Date.now()) / 1000));
      if (roomOwner) setOwner(roomOwner);
    });

    socket.on("room_owner", (roomOwner) => setOwner(roomOwner));

    return () => {
      socket.disconnect();
    };
  }, [roomId, connectedAddress]);

  // Set owner if not set yet
  useEffect(() => {
    if (!owner && users.length > 0) {
      const ownerCandidate = users[0]?.wallet;
      if (ownerCandidate) setOwner(ownerCandidate);
    }
  }, [users, owner]);

  // Timer
  useEffect(() => {
    if (roundStarted && timer > 0 && !submitted) {
      const interval = setInterval(() => setTimer((t) => t - 1), 1000);
      return () => clearInterval(interval);
    }
  }, [timer, submitted, roundStarted]);

  const handleStartRound = () => {
    if (!socketRef.current) return;
    socketRef.current.emit("start_round", { roomId, wallet: connectedAddress });
  };

  const handleSubmit = async () => {
    if (!canvasRef.current || !socketRef.current) return;
    setSubmitted(true);
    const data = await canvasRef.current.exportSvg();
    socketRef.current.emit("drawing_submit", { roomId, drawing: data });
  };

  const copyRoomLink = () => navigator.clipboard.writeText(window.location.href);

  const isOwner = owner?.toLowerCase() === connectedAddress?.toLowerCase();
  const playerCount = users.length || 1;
  const entryFeeNum = meta?.fee ? Number(meta.fee) : 0;
  const prizePool = entryFeeNum * playerCount;

  return (
    <div style={{
      background: "#fff",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      fontFamily: "'Caveat', cursive",
      color: "#222",
      gap: 16,
      padding: 24,
    }}>
      {/* HEADER */}
      <div
        style={{
          maxWidth: 860,
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 6,
        }}>
        <div style={{ minWidth: 220 }}>
          <h1 style={{ fontSize: "2.3rem", margin: 0 }}>🖍️ Chart Room: {roomId}</h1>
          <div style={{ margin: "7px 0 0 0", fontSize: "1.07rem" }}>
            Player: <b>{selfNickname}</b>{" "}
            &nbsp;|&nbsp;
            Entry Fee: <b>{entryFeeNum}</b>
            &nbsp;|&nbsp;
            <span title="Prize Pool = entry fee ✕ players">
              Prize Pool: <b> {prizePool.toLocaleString()} </b>
            </span>
            {meta?.asset && <>
              &nbsp;|&nbsp;<span>Asset: <b>{meta.asset}</b></span>
            </>}
          </div>
        </div>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginTop: 12,
        }}>
          <ConnectButton showBalance={false} />
          <button
            style={{
              border: "2px solid #9b59b6",
              borderRadius: 10,
              background: "#eaf6ff",
              padding: "7px 18px",
              fontFamily: "'Caveat', cursive",
              fontSize: "1.1rem",
              cursor: "pointer",
            }}
            onClick={copyRoomLink}
          >
            Copy Room Link
          </button>
        </div>
      </div>

      {/* Owner controls */}
      {isOwner && !roundStarted && (
        <div style={{ marginBottom: 14, textAlign: "center" }}>
          <button
            style={{
              background: "#72dfff", color: "#115163", border: "none", borderRadius: 10, fontWeight: 800,
              fontSize: "1.25rem", cursor: "pointer", padding: "15px 38px",
              boxShadow: "0 2px 12px #b7e5ed", marginRight: 12,
              transition: "all 0.14s"
            }}
            onClick={handleStartRound}
          >
            🚦 Start Round
          </button>
          <span style={{ marginLeft: 12, color: "#586777", fontSize: "1.11rem" }}>
            Waiting for all to join...
          </span>
        </div>
      )}
      {!roundStarted && (
        <div style={{
          background: "#fffae3",
          borderRadius: 10,
          fontSize: "1.15rem",
          color: "#af9000",
          padding: "10px 28px",
          fontWeight: 500,
          marginBottom: 13
        }}>
          Waiting for the round to start by the room owner...
        </div>
      )}

      {/* CONTENT */}
      <div style={{
        display: "flex",
        flexDirection: "row",
        gap: 44,
        alignItems: "flex-start",
        justifyContent: "center",
        width: "100%",
      }}>
        {/* LEFT: Players */}
        <div style={{ minWidth: 220, maxWidth: 250 }}>
          <h2 style={{ fontSize: "1.2rem", color: "#3a3a3a", marginBottom: 8 }}>👥 Players</h2>
          <ul style={{ padding: 0, listStyle: "none" }}>
            {users.map((u) =>
              <li key={u.id}
                style={{
                  background: u.isSelf ? "#fffd90" : "#fff",
                  padding: "8px 11px",
                  margin: "6px 0",
                  borderRadius: 10,
                  boxShadow: "0 2px 7px #eee",
                  fontWeight: u.isSelf ? 700 : 400,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: "#cdcdff",
                  textAlign: "center",
                  lineHeight: "26px",
                  color: "#5856b3",
                  fontWeight: 700
                }}>{u.nickname[0]?.toUpperCase() || "?"}</span>
                {u.nickname} {u.isSelf && "(you)"}
              </li>
            )}
          </ul>
          {/* Nickname input removed! */}
        </div>

        {/* CENTER: Larger Sketch Canvas */}
        <div>
          <ReactSketchCanvas
            ref={canvasRef}
            width="620"
            height="440"
            strokeColor="#232c90"
            strokeWidth={3.4}
            style={{
              borderRadius: 12,
              boxShadow: "0 5px 32px #f4e8ff",
              background: "#f9f9ff",
              border: "2px dashed #d8c1f7",
            }}
            allowOnlyPointerType="all"
          
          />

          <div style={{ display: "flex", gap: 18, marginTop: 18 }}>
            <button
              style={{
                background: "#b6efb9", color: "#292", border: "none", borderRadius: 9, padding: "12px 26px",
                fontWeight: 700, cursor: submitted ? "not-allowed" : "pointer", fontSize: "1.1rem"
              }}
              onClick={() => canvasRef.current?.undo()}
              disabled={!roundStarted || submitted || timer === 0}
            >
              Undo
            </button>
            <button
              style={{
                background: "#efc245", color: "#643e00", border: "none", borderRadius: 9,
                padding: "12px 26px", fontWeight: 700, cursor: submitted ? "not-allowed" : "pointer", fontSize: "1.05rem"
              }}
              onClick={() => canvasRef.current?.clearCanvas()}
              disabled={!roundStarted || submitted || timer === 0}
            >
              Clear
            </button>
            <button
              style={{
                background: "#8e72ff", color: "#fff", border: "none", borderRadius: 9,
                padding: "12px 48px", fontWeight: 700, fontSize: "1.1rem",
                cursor: submitted ? "not-allowed" : "pointer"
              }}
              disabled={!roundStarted || submitted || timer === 0}
              onClick={handleSubmit}
            >
              {submitted ? "Submitted!" : "Submit Chart"}
            </button>
          </div>
          <div style={{
            marginTop: 24, fontSize: "1.22rem", color: "#3e3671",
            textAlign: "center", fontWeight: 600, minHeight: 32
          }}>
            {(!roundStarted || timer === 0)
              ? "⏰ Round Over"
              : `⏰ Time Left: ${Math.floor(timer / 60)}:${String(timer % 60).padStart(2, "0")}`}
          </div>
        </div>

        {/* RIGHT: Others' Drawings */}
        <div style={{ minWidth: 240, maxWidth: 290 }}>
          <h2 style={{ fontSize: "1.13rem", marginBottom: 9, color: "#3a3a3a" }}>🖼️ Others' Charts</h2>
          <div style={{ maxHeight: 470, overflowY: "auto" }}>
            {Object.entries(drawings).filter(([id]) => !users.find(u => u.isSelf && u.id === id)).length === 0
              ? <div style={{ fontStyle: "italic", color: "#888" }}>No submissions yet.</div>
              : Object.entries(drawings)
                .filter(([id]) => !users.find(u => u.isSelf && u.id === id))
                .map(([id, svgString]) => (
                  <div key={id}
                    style={{
                      marginBottom: 18,
                      background: "#f7f3f2",
                      borderRadius: 12,
                      padding: 7,
                      boxShadow: "0 1px 8px #e9d1eb",
                    }}>
                    <div dangerouslySetInnerHTML={{ __html: svgString }} />
                  </div>
                ))}
          </div>
        </div>
      </div>
    </div>
  );
}
