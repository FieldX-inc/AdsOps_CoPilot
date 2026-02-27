import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import type { ApiError } from "@/types/domain";

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, { status: 200, ...init });
}

export function fail(status: number, error: ApiError) {
  return NextResponse.json({ error }, { status });
}

export async function requireAuth() {
  return getSessionUser();
}
