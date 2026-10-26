import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { X, ChevronRight, Check } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = "",
  onOpenAutoFocus,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  onOpenAutoFocus?: (event: Event) => void;
}) {
  const descriptionId = useId();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="modal-overlay" />
        <DialogPrimitive.Content
          className={"modal " + className}
          aria-describedby={description ? descriptionId : undefined}
          onOpenAutoFocus={onOpenAutoFocus}
        >
          <div className="modal-heading">
            <div>
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description id={descriptionId}>
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="icon-button" aria-label="关闭">
              <X size={18} />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
export function Menu({
  trigger,
  children,
  align = "end",
  onOpenChange,
  modal = true,
  onCloseAutoFocus,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [open, setOpen] = useState(false);
  const pointerType = useRef("mouse");
  const changeOpen = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  return (
    <Dropdown.Root open={open} onOpenChange={changeOpen} modal={modal}>
      <Dropdown.Trigger
        asChild
        onPointerDownCapture={(event) => {
          pointerType.current = event.pointerType;
          // Radix opens on pointerdown; touch must wait for a native click
          // so the browser can cancel activation when the gesture scrolls.
          if (event.pointerType !== "mouse") event.stopPropagation();
        }}
        onClick={(event) => {
          if (pointerType.current !== "mouse" || event.detail === 0)
            changeOpen(!open);
        }}
        onKeyDown={() => {
          pointerType.current = "mouse";
        }}
      >
        {trigger}
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="dropdown"
          align={align}
          sideOffset={7}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          {children}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
export function MenuItem({
  children,
  onClick,
  danger = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Dropdown.Item
      className={"menu-item " + (danger ? "danger" : "")}
      onSelect={onClick}
      disabled={disabled}
    >
      {children}
    </Dropdown.Item>
  );
}
export function MenuDivider() {
  return <Dropdown.Separator className="menu-divider" />;
}
export function MenuLabel({ children }: { children: ReactNode }) {
  return <Dropdown.Label className="menu-label">{children}</Dropdown.Label>;
}
export function CheckItem({
  children,
  checked,
  onChange,
}: {
  children: ReactNode;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <Dropdown.CheckboxItem
      className="menu-item"
      checked={checked}
      onCheckedChange={onChange}
      onSelect={(e) => e.preventDefault()}
    >
      <span className="check-space">{checked && <Check size={14} />}</span>
      {children}
    </Dropdown.CheckboxItem>
  );
}
export function SubMenu({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dropdown.Sub>
      <Dropdown.SubTrigger className="menu-item">
        {label}
        <ChevronRight size={14} className="ml-auto" />
      </Dropdown.SubTrigger>
      <Dropdown.Portal>
        <Dropdown.SubContent className="dropdown">
          {children}
        </Dropdown.SubContent>
      </Dropdown.Portal>
    </Dropdown.Sub>
  );
}
export function Confirm({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  label = "确认删除",
  danger = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  label?: string;
  danger?: boolean;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
    >
      <div className="modal-actions">
        <button className="button" onClick={() => onOpenChange(false)}>
          取消
        </button>
        <button
          className={"button " + (danger ? "destructive" : "primary")}
          onClick={() => {
            onConfirm();
            onOpenChange(false);
          }}
        >
          {label}
        </button>
      </div>
    </Modal>
  );
}
