import type { JSX } from "solid-js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

/** Centered card used by the sign-in, invite and device-link pages. */
export function AuthCard(props: { title: string; description?: JSX.Element; children: JSX.Element }) {
  return (
    <div class="mx-auto flex max-w-md flex-col p-4 pt-10 sm:pt-16">
      <Card>
        <CardHeader>
          <CardTitle class="text-xl">{props.title}</CardTitle>
          {props.description && <CardDescription class="leading-relaxed">{props.description}</CardDescription>}
        </CardHeader>
        <CardContent>{props.children}</CardContent>
      </Card>
    </div>
  );
}
