"use client";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useRouter } from "next/navigation";
import { useNicknameStore } from "../services/store/nicknameStore";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";


const Home: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const router = useRouter();
  const [roomId, setRoomId] = useState("");
  const [entryFee, setEntryFee] = useState("");
  const [maxParticipants, setMaxParticipants] = useState("");
  const nickname = useNicknameStore(state => state.nickname);
  const setNickname = useNicknameStore(state => state.setNickname);

  const enterRoom = () => {
    if (!roomId || !nickname) return;
    router.push(`/room/${roomId}`); // nickname now in store
  };

  

  const { data: balance } = useScaffoldReadContract({
    contractName: "SE2Token",
    functionName: "balanceOf",
    args: [connectedAddress],
  });

  const { data: roundInfo } = useScaffoldReadContract({
    contractName: "ChartPredictionMultiPoolV1",
    functionName: "getRoundInfo",
    args: [BigInt(roomId)],
  });

  const { data: nextRoundId } = useScaffoldReadContract({
    contractName: "ChartPredictionMultiPoolV1",
    functionName: "nextRoundId",
  });

  const { writeContractAsync: createRound } = useScaffoldWriteContract("ChartPredictionMultiPoolV1");
  const createRoom = async () => {
    if (!entryFee || !maxParticipants) return;
    try {
      const result = await createRound({
        functionName: "createRound",
        args: ["0x0000000000000000000000000000000000000000", BigInt(entryFee), BigInt(maxParticipants)],
      });
      // The new round ID will be the current nextRoundId
      if (nextRoundId) {
        setRoomId(nextRoundId.toString());
      }
      console.log("Room created with transaction:", result);
      // Reset if needed
      setEntryFee(""); 
      setMaxParticipants("");
    } catch (e) {
      console.error("Error creating room", e);
    }
  };


  return (
    <div
      style={{
        background: "#fff",
        minHeight: "100vh",
        color: "#111",
        fontFamily: "'Caveat', cursive",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <h1 style={{ fontSize: "3rem", marginBottom: 0 }}>🖍️ Prediction Scribble</h1>
      <p style={{ fontSize: "1.2rem", marginBottom: 32 }}>Draw your prediction, compete, and win</p>
      <div
        style={{
          background: "#f9f9f9",
          padding: 32,
          borderRadius: 14,
          boxShadow: "0 4px 16px #eee",
          minWidth: 320,
          display: "flex",
          flexDirection: "column",
          gap: 20,
          alignItems: "center"
        }}
      >
        <input
          placeholder="Nickname"
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          style={{
            padding: "8px 16px",
            fontSize: "1.2rem",
            borderRadius: 10,
            border: "2px dashed #222",
            background: "#fff",
            outline: "none",
            marginBottom: 10,
            fontFamily: "'Caveat', cursive",
          }}
        />
        <input
          placeholder="Entry Fee"
          value={entryFee}
          onChange={e => setEntryFee(e.target.value)}
          style={{
            padding: "8px 16px",
            fontSize: "1.2rem",
            borderRadius: 10,
            border: "2px dashed #222",
            background: "#fff",
            outline: "none",
            marginBottom: 10,
            fontFamily: "'Caveat', cursive",
          }}
        />
        <input
          placeholder="Max Participants"
          value={maxParticipants}
          onChange={e => setMaxParticipants(e.target.value)}
          style={{
            padding: "8px 16px",
            fontSize: "1.2rem",
            borderRadius: 10,
            border: "2px dashed #222",
            background: "#fff",
            outline: "none",
            marginBottom: 10,
            fontFamily: "'Caveat', cursive",
          }}
        />
        <button
          onClick={enterRoom}
          style={{
            fontFamily: "'Caveat', cursive",
            fontSize: "1.3rem",
            color: "#222",
            background: "#fffd90",
            border: "2px solid #222",
            borderRadius: 10,
            padding: "12px 32px",
            cursor: "pointer",
            boxShadow: "0 3px #ccc",
            marginBottom: 8,
          }}
        >
          Join Room
        </button>
        <button
          onClick={() => createRoom()}
          style={{
            fontFamily: "'Caveat', cursive",
            fontSize: "1.3rem",
            color: "#222",
            background: "#90fffd",
            border: "2px solid #222",
            borderRadius: 10,
            padding: "12px 32px",
            cursor: "pointer",
            boxShadow: "0 3px #ccc",
            marginBottom: 8,
          }}
        >
          Create Room
        </button>
       
          
        <div style={{ marginTop: 20 }}>
          <ConnectButton showBalance={false} accountStatus="avatar" />
        </div>
      </div>
    </div>
  );
};

export default Home;
