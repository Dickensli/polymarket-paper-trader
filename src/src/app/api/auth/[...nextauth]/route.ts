import { handlers } from '@/lib/auth';
import { NextRequest } from 'next/server';

export const GET = async (req: NextRequest, ctx: any) => {
  console.log('[Route.ts Entry] GET request to:', req.nextUrl.pathname, req.nextUrl.search);
  return handlers.GET(req, ctx);
};

export const POST = async (req: NextRequest, ctx: any) => {
  console.log('[Route.ts Entry] POST request to:', req.nextUrl.pathname);
  return handlers.POST(req, ctx);
};

