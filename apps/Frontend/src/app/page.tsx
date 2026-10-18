import { hasSession } from "@/lib/server/session";
import Landing from "@/components/Landing";
import "./landing.css";
export default async function Home() {
  return <Landing signedIn={await hasSession()} />;
}
