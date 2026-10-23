import * as Primitive from "@radix-ui/react-select";
import { Children, Fragment, isValidElement } from "react";
import type { ReactNode } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

// Keep option declarations close to their forms while Radix owns all interaction.
export function Select({
  children,
  value,
  onChange,
  disabled,
  ...props
}: {
  children: ReactNode;
  value?: string | number;
  onChange: (event: { target: { value: string } }) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const options: { value: string; label: ReactNode; disabled?: boolean }[] = [];
  function collect(nodes: ReactNode) {
    Children.forEach(nodes, (child) => {
      if (
        !isValidElement<{
          value?: string | number;
          children?: ReactNode;
          disabled?: boolean;
        }>(child)
      )
        return;
      if (child.type === Fragment) collect(child.props.children);
      else
        options.push({
          value: String(child.props.value ?? ""),
          label: child.props.children,
          disabled: child.props.disabled,
        });
    });
  }
  collect(children);
  const empty = "__shiye_empty_option__";
  return (
    <Primitive.Root
      value={String(value ?? "") || empty}
      disabled={disabled}
      onValueChange={(v) =>
        onChange({ target: { value: v === empty ? "" : v } })
      }
    >
      <Primitive.Trigger
        {...props}
        className={"select-trigger " + (props.className || "")}
      >
        <Primitive.Value />
        <Primitive.Icon>
          <ChevronDown size={14} />
        </Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          className="select-content"
          position="popper"
          sideOffset={5}
          collisionPadding={12}
        >
          <Primitive.ScrollUpButton className="select-scroll">
            <ChevronUp size={14} />
          </Primitive.ScrollUpButton>
          <Primitive.Viewport>
            {options.map((o) => (
              <Primitive.Item
                className="select-option"
                key={o.value}
                value={o.value || empty}
                data-value={o.value}
                disabled={o.disabled}
              >
                <Primitive.ItemText>{o.label}</Primitive.ItemText>
                <Primitive.ItemIndicator>
                  <Check size={14} />
                </Primitive.ItemIndicator>
              </Primitive.Item>
            ))}
          </Primitive.Viewport>
          <Primitive.ScrollDownButton className="select-scroll">
            <ChevronDown size={14} />
          </Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
