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
      {/* Grid + glow background already on body — just the radial overlays */}
      <div className="absolute top-1/3 left-1/4 w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, rgba(56,155,255,0.08) 0%, transparent 70%)' }} />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at center, rgba(99,102,241,0.06) 0%, transparent 70%)' }} />

      <Card className="w-full max-w-md surface-tech surface-tech-glow shadow-2xl relative z-10 backdrop-blur-sm"
        style={{ background: 'rgba(10,15,28,0.85)' }}>
        <CardHeader className="space-y-1 text-center pb-4">
          <CardTitle
            className="font-display text-3xl font-black tracking-widest text-white uppercase"
            style={{ textShadow: '0 0 30px rgba(56,155,255,0.7), 0 0 60px rgba(56,155,255,0.3)' }}>
            LEDGER<span style={{ color: '#f97316', textShadow: '0 0 24px rgba(249,115,22,0.9)' }}>.</span>AI
          </CardTitle>
          <CardDescription className="text-[10px] font-mono uppercase tracking-[0.35em] text-muted-foreground/70 mt-1">
            Financial Intelligence
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6 bg-white/5 border border-white/10 p-0.5">
              <TabsTrigger value="login" className="font-mono text-xs uppercase tracking-widest data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground rounded-sm">Login</TabsTrigger>
              <TabsTrigger value="register" className="font-mono text-xs uppercase tracking-widest data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground rounded-sm">Register</TabsTrigger>
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
                  className="font-mono text-sm bg-input border-border/50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="font-mono text-sm bg-input border-border/50"
                />
              </div>
              <Button 
                className="w-full font-mono uppercase tracking-wider text-xs" 
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
                  className="font-mono text-sm bg-input border-border/50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-password">Password</Label>
                <Input
                  id="reg-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="font-mono text-sm bg-input border-border/50"
                />
              </div>
              <Button 
                className="w-full font-mono uppercase tracking-wider text-xs" 
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
