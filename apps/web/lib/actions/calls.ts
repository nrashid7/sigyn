"use server";

import { createClient } from "@/lib/supabase/server";
import { getBusiness } from "./business";

export async function getCalls(limit = 50) {
  const business = await getBusiness();
  if (!business) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("calls")
    .select("*")
    .eq("business_id", business.id)
    // started_at is nullable (in-progress rows, and failures the provider never timed).
    // Postgres sorts NULLs first on DESC, which would float those to the top of the list.
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  return data || [];
}

export async function getCall(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("calls")
    .select("*")
    .eq("id", id)
    .single();

  return data;
}

export async function getCallTranscript(callId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("call_transcripts")
    .select("*")
    .eq("call_id", callId)
    .single();

  return data;
}

export async function getCallStats() {
  const business = await getBusiness();
  if (!business) {
    return {
      totalCalls: 0,
      answeredRate: 0,
      avgDuration: 0,
      bookings: 0,
    };
  }

  const supabase = await createClient();
  const { data: calls } = await supabase
    .from("calls")
    .select("status, outcome, duration_seconds")
    .eq("business_id", business.id);

  if (!calls || calls.length === 0) {
    return { totalCalls: 0, answeredRate: 0, avgDuration: 0, bookings: 0 };
  }

  const totalCalls = calls.length;
  const completed = calls.filter((c) => c.status === "completed").length;
  const answeredRate = Math.round((completed / totalCalls) * 100);
  const avgDuration = Math.round(
    calls.reduce((sum, c) => sum + (c.duration_seconds || 0), 0) / totalCalls
  );
  const bookings = calls.filter((c) => c.outcome === "booked").length;

  return { totalCalls, answeredRate, avgDuration, bookings };
}
