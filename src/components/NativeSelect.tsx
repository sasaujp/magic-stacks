import { For, splitProps, type JSX } from "solid-js";
import { cn } from "~/lib/utils";

/** A plain <select> styled like the Solid UI inputs (for small, form-like choices). */
export function NativeSelect<T extends string>(
  props: { value: T; onChange: (v: T) => void; options: readonly { value: T; label: string }[] } & Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">,
) {
  const [local, rest] = splitProps(props, ["value", "onChange", "options", "class"]);
  return (
    <select
      {...rest}
      class={cn(
        "h-10 rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50",
        local.class,
      )}
      value={local.value}
      onChange={e => local.onChange(e.currentTarget.value as T)}
    >
      <For each={local.options}>{o => <option value={o.value}>{o.label}</option>}</For>
    </select>
  );
}
