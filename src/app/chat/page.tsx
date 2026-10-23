import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChatApp } from "@/components/chat/ChatApp";

export default async function ChatPage() {
  const { data: { user } } = await createClient().auth.getUser();
  if (!user) redirect("/login");
  return <ChatApp meId={user.id} />;
}
