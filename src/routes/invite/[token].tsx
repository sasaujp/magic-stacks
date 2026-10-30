import { useParams } from "@solidjs/router";
import { RegisterPasskey } from "~/components/RegisterPasskey";

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  return <RegisterPasskey token={params.token} expect="invite" />;
}
