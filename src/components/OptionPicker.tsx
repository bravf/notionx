import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { useState } from "react";
import type { ReactNode } from "react";
import { Check, Plus, Search } from "lucide-react";

export function OptionPicker({
  children,
  label,
  options,
  value,
  multiple = false,
  onChange,
  onCreateOption,
}: {
  children: ReactNode;
  label: string;
  options: string[];
  value: string | string[] | null;
  multiple?: boolean;
  onChange: (value: string | string[] | null) => void;
  onCreateOption?: (name: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const trimmed = query.trim();
  const canCreate =
    !!onCreateOption &&
    !!trimmed &&
    !options.some((option) => option.toLowerCase() === trimmed.toLowerCase());
  const choose = (option: string) => {
    onChange(
      multiple
        ? selected.includes(option)
          ? selected.filter((v) => v !== option)
          : [...selected, option]
        : option,
    );
    setQuery("");
    if (!multiple) setOpen(false);
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
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
                placeholder="搜索或输入新选项…"
                aria-label={`搜索${label}选项`}
                value={query}
                onValueChange={setQuery}
              />
            </div>
            <Command.List>
              <Command.Empty>没有匹配的选项</Command.Empty>
              {options.map((option) => (
                <Command.Item
                  key={option}
                  value={option}
                  onSelect={() => choose(option)}
                >
                  <span>{option}</span>
                  {selected.includes(option) && <Check size={15} />}
                </Command.Item>
              ))}
              {canCreate && (
                <Command.Item
                  value={trimmed}
                  onSelect={() => {
                    onCreateOption?.(trimmed);
                    choose(trimmed);
                  }}
                >
                  <span className="create-option">
                    <Plus size={14} />
                    创建「{trimmed}」
                  </span>
                </Command.Item>
              )}
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
