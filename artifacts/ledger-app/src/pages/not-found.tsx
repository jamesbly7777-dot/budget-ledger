import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md mx-4 surface-tech-strong border-cyan-500/20">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-red-400 shrink-0" />
            <h1 className="font-display text-xl font-bold uppercase tracking-wider text-foreground">404 — Not Found</h1>
          </div>

          <p className="mt-4 text-sm text-muted-foreground font-mono">
            This route is not wired in the app router.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
