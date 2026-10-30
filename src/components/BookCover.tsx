import { createSignal, Show } from "solid-js";
import { cn } from "~/lib/utils";

/**
 * A book's cover from R2 (/api/covers/:id), or — when there is none or it fails to load — a
 * typographic cover drawn from the title and author.
 */
export function BookCover(props: { bookId: number; hasCover: boolean; title: string; author?: string | null; class?: string; size?: "sm" | "md" }) {
  const [failed, setFailed] = createSignal(false);
  return (
    <div class={cn("relative aspect-[2/3] overflow-hidden rounded-md border bg-muted shadow-sm", props.size === "sm" ? "w-12" : "w-full", props.class)}>
      <Show
        when={props.hasCover && !failed()}
        fallback={
          <div class="flex h-full flex-col justify-between bg-gradient-to-b from-secondary to-muted p-[8%] text-secondary-foreground">
            <Show when={props.size !== "sm"}>
              <p class="source line-clamp-5 text-[clamp(0.7rem,1.1vw,1rem)] font-semibold leading-tight">{props.title}</p>
              <p class="source truncate text-[clamp(0.6rem,0.8vw,0.8rem)] italic opacity-75">{props.author}</p>
            </Show>
          </div>
        }
      >
        <img src={`/api/covers/${props.bookId}`} alt="" loading="lazy" class="h-full w-full object-cover" onError={() => setFailed(true)} />
      </Show>
    </div>
  );
}
