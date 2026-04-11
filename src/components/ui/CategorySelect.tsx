import { useState } from "react";
import { PlusCircle, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CategorySelectProps {
  value: string;
  onChange: (v: string) => void;
  allCategories: string[];
  onAdd: (cat: string) => void;
  className?: string;
  triggerClassName?: string;
}

export function CategorySelect({
  value,
  onChange,
  allCategories,
  onAdd,
  className,
  triggerClassName,
}: CategorySelectProps) {
  const [addMode, setAddMode] = useState(false);
  const [newCat, setNewCat] = useState("");

  const handleCommit = () => {
    const trimmed = newCat.trim();
    if (!trimmed) { setAddMode(false); return; }
    onAdd(trimmed);
    onChange(trimmed);
    setNewCat("");
    setAddMode(false);
  };

  if (addMode) {
    return (
      <div className={`flex gap-1 ${className ?? ""}`}>
        <Input
          autoFocus
          placeholder="New category name"
          value={newCat}
          onChange={(e) => setNewCat(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCommit();
            if (e.key === "Escape") setAddMode(false);
          }}
          className="font-mono bg-input border-border text-sm h-9"
        />
        <Button size="sm" className="h-9 px-2" onClick={handleCommit}>
          <PlusCircle className="w-4 h-4" />
        </Button>
        <Button size="sm" variant="ghost" className="h-9 px-2" onClick={() => setAddMode(false)}>
          <X className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v === "__add__") { setAddMode(true); }
        else { onChange(v); }
      }}
    >
      <SelectTrigger className={`font-mono bg-input border-border ${triggerClassName ?? ""}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allCategories.map((c) => (
          <SelectItem key={c} value={c}>{c}</SelectItem>
        ))}
        <SelectItem
          value="__add__"
          className="text-primary font-mono text-xs border-t border-border mt-1 pt-1"
        >
          + Add custom category...
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
