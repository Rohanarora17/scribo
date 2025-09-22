"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useNicknameStore } from "../services/store/nicknameStore";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { NextPage } from "next";
import { erc20Abi } from "viem";
import { useAccount, useBalance, useReadContract, useSimulateContract, useWriteContract } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import io, { Socket } from "socket.io-client";

const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const CONTRACT_ADDRESS = "0x5Db4656E79AfC135Fe156174bEbf27C89a3A0bdF" as const;

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

const inputStyle: React.CSSProperties = {
  padding: "10px 16px",
  fontSize: "1.1rem",
  borderRadius: 10,
  border: "2px dashed #222",
  background: "#fff",
  outline: "none",
  fontFamily: "'Caveat', cursive",
  width: "100%",
};
const buttonStyle: React.CSSProperties = {
  fontFamily: "'Caveat', cursive",
  fontSize: "1.2rem",
  color: "#222",
  border: "2px solid #222",
  borderRadius: 10,
  padding: "12px 32px",
  cursor: "pointer",
  boxShadow: "0 3px #ccc",
  transition: "all 0.2s ease-in-out",
  width: "100%",
};
const cardStyle: React.CSSProperties = {
  background: "#f9f9f9",
  padding: 32,
  borderRadius: 14,
  boxShadow: "0 4px 16px #eee",
  width: "100%",
  maxWidth: 400,
  display: "flex",
  flexDirection: "column",
  gap: 16,
  alignItems: "center",
};

const Home: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const router = useRouter();

  const [roomId, setRoomId] = useState<string>("");
  const [entryFee, setEntryFee] = useState<string>("");
  const [maxParticipants, setMaxParticipants] = useState<string>("");
  const [joinError, setJoinError] = useState<string>("");
  const [joinLoading, setJoinLoading] = useState<boolean>(false);
  const [approvalStatus, setApprovalStatus] = useState<"checking" | "needed" | "pending" | "sufficient">("checking");

  const nickname = useNicknameStore(state => state.nickname);
  const setNickname = useNicknameStore(state => state.setNickname);

  // --- SOCKET.IO Lobby Connect ---
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ["websocket"] });
    socketRef.current = socket;
    return () => { socket.disconnect(); };  // ← returns nothing!
  }, []);
  

  // --- Contract Hooks (Unchanged) ---
  const { data: joinInfo, refetch: refetchJoinInfo } = useScaffoldReadContract({
    contractName: "ChartPredictionMultiPoolV2",
    functionName: "getRoundInfo",
    args: roomId && !isNaN(Number(roomId)) ? [BigInt(roomId)] : undefined,
    query: { enabled: Boolean(roomId && !isNaN(Number(roomId))) },
  });

  const entryFeeBigInt = useMemo<bigint | undefined>(() => {
    const val = joinInfo?.[2];
    if (val !== undefined && val !== null) return BigInt(val.toString());
    return undefined;
  }, [joinInfo]);

  const {
    data: allowance,
    refetch: refetchAllowance,
    error: allowanceError,
    isLoading: allowanceLoading,
  } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "allowance",
    args: connectedAddress ? [connectedAddress as `0x${string}`, CONTRACT_ADDRESS as `0x${string}`] : undefined,
    query: { enabled: Boolean(connectedAddress), retry: 3, retryDelay: 1000 },
  });

  const {
    data: approvalData,
    error: simulateError,
    isLoading: isSimulating,
    refetch: refetchSimulation,
  } = useSimulateContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "approve",
    args: [CONTRACT_ADDRESS, entryFeeBigInt ?? 0n],
    query: {
      enabled: Boolean(connectedAddress && entryFeeBigInt && entryFeeBigInt > 0n && allowance !== undefined),
      retry: 3,
      retryDelay: 1000,
    },
  });

  const { writeContract: writeApprove, isPending: isApproving } = useWriteContract();
  const { writeContractAsync: joinPool, isMining: isJoining } = useScaffoldWriteContract({
    contractName: "ChartPredictionMultiPoolV2",
  });

  const { data: usdcBalance } = useBalance({
    address: connectedAddress,
    token: USDC_ADDRESS,
    query: { enabled: Boolean(connectedAddress) },
  });
  const { writeContractAsync: createRound, isMining } = useScaffoldWriteContract({
    contractName: "ChartPredictionMultiPoolV2",
  });

  // --- Approval status effect (unchanged)
  useEffect(() => {
    if (!connectedAddress || !entryFeeBigInt || allowance === undefined) {
      setApprovalStatus("checking");
      return;
    }
    const currentAllowance = BigInt(allowance.toString());
    if (currentAllowance >= entryFeeBigInt) setApprovalStatus("sufficient");
    else setApprovalStatus("needed");
  }, [connectedAddress, entryFeeBigInt, allowance]);

  // --- HANDLERS (Mostly Unchanged, with socket emit on join) ---
  const handleApprove = async (): Promise<void> => {
    setJoinError("");
    try {
      if (!approvalData?.request) {
        let retryCount = 0;
        const maxRetries = 3;
        while (!approvalData?.request && retryCount < maxRetries) {
          await refetchSimulation();
          await new Promise(resolve => setTimeout(resolve, 1500));
          retryCount++;
        }
        if (!approvalData?.request) throw new Error("Unable to prepare approval transaction after retries");
      }
      setApprovalStatus("pending");
      await new Promise<void>((resolve, reject) => {
        writeApprove(approvalData.request, {
          onSuccess: async () => {
            setTimeout(async () => {
              await refetchAllowance();
              setApprovalStatus("sufficient");
              resolve();
            }, 8000);
          },
          onError: error => {
            setApprovalStatus("needed");
            reject(error);
          },
        });
      });
    } catch (err: any) {
      setApprovalStatus("needed");
      setJoinError(err?.shortMessage || err?.message || "Failed to approve USDC spending");
    }
  };

  const handleJoinRoom = async (): Promise<void> => {
    setJoinError("");
    setJoinLoading(true);
    try {
      if (!roomId || !nickname) throw new Error("Please enter both room code and nickname");
      await refetchJoinInfo();
      if (!joinInfo || joinInfo[0] === "0x0000000000000000000000000000000000000000") {
        throw new Error("That room doesn't exist or has ended");
      }
      if (approvalStatus !== "sufficient") throw new Error("Please approve USDC spending first");
      await refetchAllowance();
      if (allowance === undefined || entryFeeBigInt === undefined) throw new Error("Unable to verify allowance.");
      const currentAllowance = BigInt(allowance.toString());
      if (currentAllowance < entryFeeBigInt) {
        setApprovalStatus("needed");
        throw new Error("Insufficient allowance. Please approve again.");
      }

      // On successful contract join, emit presence for lobby (optional for future features)
      socketRef.current?.emit("join_lobby_room", {
        roomId,
        nickname,
        wallet: connectedAddress,
      });

      await joinPool({
        functionName: "joinPool",
        args: [BigInt(roomId)],
      });

      // Pass nickname, wallet, fee to the room page via query (or use your store)
      router.push(`/room/${roomId}?nickname=${encodeURIComponent(nickname)}&wallet=${connectedAddress}`);
    } catch (err: any) {
      setJoinError(err?.shortMessage || err?.message || "Failed to join room");
    }
    setJoinLoading(false);
  };

  const handleCreateRoom = async (): Promise<void> => {
    if (!entryFee || !maxParticipants) {
      alert("Please fill in all fields");
      return;
    }
    if (!connectedAddress) {
      alert("Please connect your wallet first");
      return;
    }
    let entryFeeBig: bigint;
    try {
      entryFeeBig = BigInt(Math.floor(Number(entryFee) * 1_000_000));
    } catch {
      alert("Invalid entry fee");
      return;
    }
    if (usdcBalance?.value === undefined || usdcBalance.value < entryFeeBig) {
      alert("You don't have enough USDC to create a room.");
      return;
    }
    try {
      const maxParts = BigInt(Number(maxParticipants));
      // Contract call
      const tx = await createRound({
        functionName: "createRound",
        args: [USDC_ADDRESS, entryFeeBig, maxParts],
      });

      console.log("tx", tx);
  
      // Now, either get roomId from contract log/event or by asking the backend!
      // Example: ask backend to register/lookup the created room and notify you
      socketRef.current?.emit("create_lobby_room", {
        entryFee,
        maxParticipants,
        wallet: connectedAddress,
        nickname, 
        // Add any on-chain roomId if available!
      });
  
      // Listen for when backend is ready and assigns roomId
      socketRef.current?.once("room_created", ({ roomId }) => {
        router.push(`/room/${roomId}`); // Redirect!
      });
  
      // Backend will now emit the room_created event with room id for you to redirect.
      setEntryFee("");
      setMaxParticipants("");
    } catch (e: any) {
      alert(e?.shortMessage || e?.message || "Unknown error");
    }
  };

  type ButtonState = {
    disabled: boolean;
    text: string;
    action: (() => void) | null;
    style?: React.CSSProperties;
  };

  const getButtonState = (): ButtonState => {
    if (!connectedAddress) return { disabled: true, text: "Connect Wallet", action: null };
    if (!roomId || !nickname) return { disabled: true, text: "Enter Room Code & Nickname", action: null };
    if (allowanceLoading || isSimulating) return { disabled: true, text: "Loading...", action: null };
    switch (approvalStatus) {
      case "checking":
        return { disabled: true, text: "Checking Allowance...", action: null };
      case "needed":
        if (isApproving) return { disabled: true, text: "Approving...", action: null };
        if (!approvalData?.request) return { disabled: true, text: "Preparing Approval...", action: null };
        return {
          disabled: false,
          text: `Approve ${entryFeeBigInt ? Number(entryFeeBigInt) / 1_000_000 : "0"} USDC`,
          action: handleApprove,
          style: { background: "#eee" },
        };
      case "pending":
        return { disabled: true, text: "Approval Pending...", action: null };
      case "sufficient":
        if (isJoining || joinLoading) return { disabled: true, text: "Joining...", action: null };
        return {
          disabled: false,
          text: "Join Room",
          action: handleJoinRoom,
          style: { background: "#fffd90" },
        };
      default:
        return { disabled: true, text: "Unknown State", action: null };
    }
  };

  const buttonState = getButtonState();

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
        padding: 24,
        gap: 32,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "3rem", marginBottom: 8 }}>🖍️ Prediction Scribble</h1>
        <p style={{ fontSize: "1.2rem", margin: 0 }}>Draw your prediction, compete, and win</p>
      </div>
      <div style={cardStyle}>
        <input
          placeholder="Nickname"
          value={nickname ?? ""}
          onChange={e => setNickname(e.target.value)}
          style={inputStyle}
        />
        <input
          placeholder="Room Code"
          value={roomId ?? ""}
          onChange={e => setRoomId(e.target.value)}
          style={inputStyle}
        />
        {joinError && (
          <div
            style={{
              color: "red",
              fontSize: "1rem",
              textAlign: "center",
              padding: "8px",
              background: "#ffeaea",
              borderRadius: "8px",
              border: "1px solid #ffcccc",
            }}
          >
            {joinError}
          </div>
        )}
        <button
          onClick={buttonState.action || (() => {})}
          disabled={buttonState.disabled}
          style={{
            ...buttonStyle,
            ...buttonState.style,
            cursor: buttonState.disabled ? "not-allowed" : "pointer",
            opacity: buttonState.disabled ? 0.6 : 1,
          }}
        >
          {buttonState.text}
        </button>
        <div
          style={{
            width: "100%",
            borderTop: "2px dashed #ddd",
            paddingTop: "16px",
            marginTop: "16px",
          }}
        >
          <input
            type="number"
            min="0"
            step="0.000001"
            placeholder="Entry Fee (USDC, e.g. 1)"
            value={entryFee ?? ""}
            onChange={e => setEntryFee(e.target.value)}
            style={inputStyle}
          />
          <input
            type="number"
            min="2"
            max="100"
            step="1"
            placeholder="Max Participants (min 2)"
            value={maxParticipants ?? ""}
            onChange={e => setMaxParticipants(e.target.value)}
            style={inputStyle}
          />
          <button
            onClick={handleCreateRoom}
            disabled={isMining || !entryFee || !maxParticipants || !connectedAddress}
            style={{
              ...buttonStyle,
              background: "#90fffd",
              cursor: isMining || !entryFee || !maxParticipants || !connectedAddress ? "not-allowed" : "pointer",
              opacity: isMining || !entryFee || !maxParticipants || !connectedAddress ? 0.6 : 1,
            }}
          >
            {isMining ? "Creating..." : "Create Room"}
          </button>
        </div>
      </div>
      <div>
        <ConnectButton showBalance={false} accountStatus="avatar" />
      </div>
    </div>
  );
};

export default Home;
