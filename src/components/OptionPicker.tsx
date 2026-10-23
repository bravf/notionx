import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { useState } from "react";
import type { ReactNode } from "react";
import { Check, Search } from "lucide-react";

export function OptionPicker({
  children,
  label,
  options,
  value,
  multiple = false,
  onChange,
}: {
  children: ReactNode;
  label: string;
  options: string[];
  value: string | string[] | null;
  multiple?: boolean;
  onChange: (value: string | string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="option-picker"
          align="start"
          sideOffset={5}
          collisionPadding={12}
        >
          <Command loop label={`搜索${label}选项`}>
            <div className="option-search">
              <Search size={15} />
              <Command.Input
                placeholder="搜索选项…"
                aria-label={`搜索${label}选项`}
              />
            </div>
            <Command.List>
              <Command.Empty>没有匹配的选项</Command.Empty>
              {options.map((option) => (
                <Command.Item
                  key={option}
                  value={option}
                  onSelect={() => {
                    onChange(
                      multiple
                        ? selected.includes(option)
                          ? selected.filter((v) => v !== option)
                          : [...selected, option]
                        : option,
                    );
                    if (!multiple) setOpen(false);
                  }}
                >
                  <span>{option}</span>
                  {selected.includes(option) && <Check size={15} />}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
          <div className="option-footer">
            <button
              onClick={() => {
                onChange(multiple ? [] : null);
                if (!multiple) setOpen(false);
              }}
            >
              清空
            </button>
            {multiple ? (
              <button onClick={() => setOpen(false)}>
                完成 · {selected.length}
              </button>
            ) : (
              <span>↑ ↓ 选择 · ↵ 确定</span>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
