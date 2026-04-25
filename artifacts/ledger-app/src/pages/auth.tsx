import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export default function AuthPage() {
  const { login, register } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAuth = async (action: "login" | "register") => {
    try {
      setLoading(true);
      if (action === "login") {
        await login(email, password);
      } else {
        await register(email, password);
      }
      setLocation("/dashboard");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Authentication Failed",
        description: error.message || "An error occurred",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/4 w-[28rem] h-[28rem] bg-primary/15 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[28rem] h-[28rem] bg-violet-600/12 rounded-full blur-[100px] pointer-events-none" />
      <div
        className="absolute inset-0 opacity-[0.35] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(hsl(187 100% 50% / 0.06) 1px, transparent 1px), linear-gradient(90deg, hsl(187 100% 50% / 0.06) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <Card className="w-full max-w-md relative z-10 surface-tech-strong border-cyan-500/30">
        <CardHeader className="space-y-1 text-center pb-2">
          <div className="flex justify-center gap-1.5 mb-2">
            <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_10px_hsl(187_100%_50%)]" />
            <span className="h-1.5 w-1.5 rounded-full bg-primary/40" />
            <span className="h-1.5 w-1.5 rounded-full bg-primary/20" />
          </div>
          <CardTitle className="font-display text-3xl font-bold tracking-[0.25em] text-primary uppercase text-glow-cyan">
            Ledger
          </CardTitle>
          <CardDescription className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground mt-3 font-mono">
            Secure Access
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6 bg-black/30 border border-cyan-500/20 p-1 rounded-lg backdrop-blur-sm">
              <TabsTrigger
                value="login"
                className="font-mono text-[10px] uppercase tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:shadow-[0_0_16px_-4px_hsl(187_100%_50%_/_.4)] text-muted-foreground rounded-md"
              >
                Login
              </TabsTrigger>
              <TabsTrigger
                value="register"
                className="font-mono text-[10px] uppercase tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:shadow-[0_0_16px_-4px_hsl(187_100%_50%_/_.4)] text-muted-foreground rounded-md"
              >
                Register
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="login" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="operator@system.io"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="font-mono text-sm bg-input/80 border-cyan-500/20 backdrop-blur-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="font-mono text-sm bg-input/80 border-cyan-500/20 backdrop-blur-sm"
                />
              </div>
              <Button
                className="w-full font-mono uppercase tracking-[0.2em] text-xs bg-primary text-primary-foreground shadow-[0_0_24px_-6px_hsl(187_100%_50%_/_.6)] hover:shadow-[0_0_28px_-4px_hsl(187_100%_55%_/_.7)]"
                onClick={() => handleAuth("login")}
                disabled={loading}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Authenticate
              </Button>
            </TabsContent>

            <TabsContent value="register" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reg-email">Email</Label>
                <Input
                  id="reg-email"
                  type="email"
                  placeholder="operator@system.io"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="font-mono text-sm bg-input/80 border-cyan-500/20 backdrop-blur-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-password">Password</Label>
                <Input
                  id="reg-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="font-mono text-sm bg-input/80 border-cyan-500/20 backdrop-blur-sm"
                />
              </div>
              <Button
                className="w-full font-mono uppercase tracking-[0.2em] text-xs bg-primary text-primary-foreground shadow-[0_0_24px_-6px_hsl(187_100%_50%_/_.6)] hover:shadow-[0_0_28px_-4px_hsl(187_100%_55%_/_.7)]"
                onClick={() => handleAuth("register")}
                disabled={loading}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Initialize Account
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
