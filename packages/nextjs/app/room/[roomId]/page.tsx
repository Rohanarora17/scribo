import RoomPage from "./roomPage";

export default async function Page({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params; // ✅ await it here
  return <RoomPage roomId={roomId} />;
}
