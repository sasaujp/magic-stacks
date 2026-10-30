import { useParams } from "@solidjs/router";
import { RegisterPasskey } from "~/components/RegisterPasskey";

export default function DeviceLinkPage() {
  const params = useParams<{ token: string }>();
  return <RegisterPasskey token={params.token} expect="device" />;
}
