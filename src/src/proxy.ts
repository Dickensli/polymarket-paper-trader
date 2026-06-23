import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Initialize Redis only if UPSTASH_REDIS_REST_URL is available
const redis = process.env.UPSTASH_REDIS_REST_URL
  ? Redis.fromEnv()
  : null;

const apiLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, "1 m"),
      analytics: true,
      prefix: "ratelimit:api",
    })
  : null;

const tradeLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "1 m"),
      prefix: "ratelimit:trade",
    })
  : null;

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isApiRoute = pathname.startsWith("/api");
  const isAuthRoute = pathname.startsWith("/api/auth");
  const isTradeRoute = pathname.startsWith("/api/trade");
  const isPortfolioRoute = pathname.startsWith("/api/portfolio");
  const isUserRoute = pathname.startsWith("/api/user");

  // Check for NextAuth session cookie (works for both HTTP and HTTPS deployments)
  const sessionToken = 
    request.cookies.get("authjs.session-token")?.value || 
    request.cookies.get("__Secure-authjs.session-token")?.value;

  const agentSecret = request.headers.get("x-agent-secret");
  const isAgentRequest = agentSecret && agentSecret === (process.env.AGENT_SECRET || "default_secret_key_123");

  // 1. Edge Authentication Filter
  if ((isTradeRoute || isPortfolioRoute || isUserRoute) && !sessionToken && !isAgentRequest) {
    return NextResponse.json(
      { error: "Unauthorized access", code: "UNAUTHORIZED" }, 
      { status: 401 }
    );
  }

  // 2. Edge Rate Limiting (Using Upstash Redis)
  if (redis && isApiRoute && !isAuthRoute) {
    const ip = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for") || "127.0.0.1";
    // Use session token for authenticated users, IP for guests
    const identifier = sessionToken || ip;

    const ratelimit = isTradeRoute ? tradeLimiter : apiLimiter;

    if (ratelimit) {
      const { success, limit, reset, remaining } = await ratelimit.limit(identifier);
      
      if (!success) {
        return NextResponse.json(
          { error: "Too many requests", code: "RATE_LIMITED" },
          {
            status: 429,
            headers: {
              "X-RateLimit-Limit": limit.toString(),
              "X-RateLimit-Remaining": remaining.toString(),
              "X-RateLimit-Reset": reset.toString(),
            },
          }
        );
      }
      
      const response = NextResponse.next();
      response.headers.set("X-RateLimit-Limit", limit.toString());
      response.headers.set("X-RateLimit-Remaining", remaining.toString());
      response.headers.set("X-RateLimit-Reset", reset.toString());
      return response;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
